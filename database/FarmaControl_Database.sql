/* =====================================================================
   FarmaControl | Script de creacion de base de datos | SQL Server 2019+
   Sistema academico de gestion de ventas de farmacia (datos ficticios).

   COMO EJECUTAR
     SSMS : abrir el archivo y ejecutar (F5) con una conexion con permiso
            para crear bases de datos.
     CLI  : sqlcmd -S localhost -E -i FarmaControl_Database.sql
            (use -U/-P si utiliza autenticacion SQL).
   El script es re-ejecutable: crea solo lo que falta y no vuelve a cargar
   los datos de demostracion si la tabla dbo.Rol ya tiene filas.
   Para recrear desde cero use FarmaControl_Reset.sql (BORRA la base).

   MODELO: 14 tablas = 13 del informe original + dbo.AuditoriaOperacion
   (RF-18, auditoria centralizada). Cambios respecto al script original:
     * Venta: fecha_anulacion, usuario_anulacion_id y motivo_anulacion
       (trazabilidad de la anulacion, CU-12).
     * Cliente: CHECK de formato de documento (DNI 8, RUC 11 digitos).
     * MovimientoStock: indices unicos filtrados que impiden duplicar
       movimientos de una misma operacion y lote.
     * Procedimientos: numeracion por SEQUENCE, validacion de rol en la
       anulacion, factura solo para clientes con RUC, auditoria dentro de
       la misma transaccion y rechazo de ingresos a lotes vencidos.
     * Vista vw_AlertasLote: incorpora la alerta AGOTADO.

   SEGURIDAD: las contrasenas de demostracion se almacenan solo como hash
   scrypt (nunca en texto plano). Credenciales de PRUEBA en README.md.
   Los comprobantes BOLETA/FACTURA son SIMULADOS (sin integracion SUNAT).
   ===================================================================== */
IF DB_ID(N'FarmaControlBD') IS NULL
    CREATE DATABASE FarmaControlBD;
GO
USE FarmaControlBD;
GO
SET NOCOUNT ON;
GO

/* ------------------------- 01. Seguridad y catalogos ------------------------- */
IF OBJECT_ID(N'dbo.Rol', N'U') IS NULL
CREATE TABLE dbo.Rol (
    rol_id      INT IDENTITY(1,1) CONSTRAINT PK_Rol PRIMARY KEY,
    nombre      NVARCHAR(40)  NOT NULL CONSTRAINT UQ_Rol_Nombre UNIQUE,
    descripcion NVARCHAR(180) NULL
);
GO
IF OBJECT_ID(N'dbo.Usuario', N'U') IS NULL
CREATE TABLE dbo.Usuario (
    usuario_id      INT IDENTITY(1,1) CONSTRAINT PK_Usuario PRIMARY KEY,
    rol_id          INT           NOT NULL,
    nombres         NVARCHAR(120) NOT NULL,
    correo          NVARCHAR(160) NOT NULL CONSTRAINT UQ_Usuario_Correo UNIQUE,
    hash_contrasena NVARCHAR(255) NOT NULL,
    activo          BIT           NOT NULL CONSTRAINT DF_Usuario_Activo DEFAULT (1),
    CONSTRAINT FK_Usuario_Rol FOREIGN KEY (rol_id) REFERENCES dbo.Rol(rol_id)
);
GO
IF OBJECT_ID(N'dbo.Cliente', N'U') IS NULL
CREATE TABLE dbo.Cliente (
    cliente_id          INT IDENTITY(1,1) CONSTRAINT PK_Cliente PRIMARY KEY,
    tipo_documento      VARCHAR(3)    NOT NULL,
    numero_documento    VARCHAR(15)   NOT NULL,
    nombre_razon_social NVARCHAR(160) NOT NULL,
    telefono            VARCHAR(20)   NULL,
    CONSTRAINT CK_Cliente_TipoDoc CHECK (tipo_documento IN ('DNI','CE','RUC','OTR')),
    CONSTRAINT CK_Cliente_Doc CHECK (
        (tipo_documento = 'DNI' AND LEN(numero_documento) = 8  AND numero_documento NOT LIKE '%[^0-9]%')
     OR (tipo_documento = 'RUC' AND LEN(numero_documento) = 11 AND numero_documento NOT LIKE '%[^0-9]%')
     OR (tipo_documento IN ('CE','OTR') AND LEN(numero_documento) BETWEEN 4 AND 15)),
    CONSTRAINT UQ_Cliente_Doc UNIQUE (tipo_documento, numero_documento)
);
GO
IF OBJECT_ID(N'dbo.Proveedor', N'U') IS NULL
CREATE TABLE dbo.Proveedor (
    proveedor_id INT IDENTITY(1,1) CONSTRAINT PK_Proveedor PRIMARY KEY,
    ruc          CHAR(11)      NOT NULL CONSTRAINT UQ_Proveedor_Ruc UNIQUE,
    razon_social NVARCHAR(180) NOT NULL,
    contacto     NVARCHAR(120) NULL,
    telefono     VARCHAR(20)   NULL,
    activo       BIT           NOT NULL CONSTRAINT DF_Proveedor_Activo DEFAULT (1),
    CONSTRAINT CK_Proveedor_RUC CHECK (ruc NOT LIKE '%[^0-9]%')
);
GO
IF OBJECT_ID(N'dbo.Categoria', N'U') IS NULL
CREATE TABLE dbo.Categoria (
    categoria_id INT IDENTITY(1,1) CONSTRAINT PK_Categoria PRIMARY KEY,
    nombre       NVARCHAR(90) NOT NULL CONSTRAINT UQ_Categoria_Nombre UNIQUE
);
GO
IF OBJECT_ID(N'dbo.Medicamento', N'U') IS NULL
CREATE TABLE dbo.Medicamento (
    medicamento_id   INT IDENTITY(1,1) CONSTRAINT PK_Medicamento PRIMARY KEY,
    categoria_id     INT           NOT NULL,
    sku              VARCHAR(30)   NOT NULL CONSTRAINT UQ_Medicamento_Sku UNIQUE,
    nombre           NVARCHAR(160) NOT NULL,
    principio_activo NVARCHAR(160) NULL,
    presentacion     NVARCHAR(90)  NOT NULL,
    precio_venta     DECIMAL(12,2) NOT NULL,
    requiere_receta  BIT NOT NULL CONSTRAINT DF_Medicamento_Receta DEFAULT (0),
    activo           BIT NOT NULL CONSTRAINT DF_Medicamento_Activo DEFAULT (1),
    CONSTRAINT CK_Medicamento_Precio CHECK (precio_venta >= 0),
    CONSTRAINT FK_Medicamento_Categoria FOREIGN KEY (categoria_id) REFERENCES dbo.Categoria(categoria_id)
);
GO

/* ------------------------- 02. Recetas, lotes y compras ------------------------- */
IF OBJECT_ID(N'dbo.Receta', N'U') IS NULL
CREATE TABLE dbo.Receta (
    receta_id          INT IDENTITY(1,1) CONSTRAINT PK_Receta PRIMARY KEY,
    cliente_id         INT           NOT NULL,
    numero_receta      VARCHAR(50)   NOT NULL CONSTRAINT UQ_Receta_Numero UNIQUE,
    nombre_prescriptor NVARCHAR(160) NOT NULL,
    fecha_emision      DATE          NOT NULL,
    fecha_vencimiento  DATE          NOT NULL,
    estado             VARCHAR(12)   NOT NULL CONSTRAINT DF_Receta_Estado DEFAULT ('VALIDA'),
    observacion        NVARCHAR(250) NULL,
    CONSTRAINT FK_Receta_Cliente FOREIGN KEY (cliente_id) REFERENCES dbo.Cliente(cliente_id),
    CONSTRAINT CK_Receta_Fechas CHECK (fecha_vencimiento >= fecha_emision),
    CONSTRAINT CK_Receta_Estado CHECK (estado IN ('VALIDA','ANULADA'))
);
GO
IF OBJECT_ID(N'dbo.Lote', N'U') IS NULL
CREATE TABLE dbo.Lote (
    lote_id           INT IDENTITY(1,1) CONSTRAINT PK_Lote PRIMARY KEY,
    medicamento_id    INT          NOT NULL,
    codigo_lote       NVARCHAR(60) NOT NULL,
    fecha_vencimiento DATE         NOT NULL,
    stock_actual      INT NOT NULL CONSTRAINT DF_Lote_Stock  DEFAULT (0),
    stock_minimo      INT NOT NULL CONSTRAINT DF_Lote_Minimo DEFAULT (5),
    CONSTRAINT FK_Lote_Medicamento FOREIGN KEY (medicamento_id) REFERENCES dbo.Medicamento(medicamento_id),
    CONSTRAINT UQ_Lote_Codigo UNIQUE (medicamento_id, codigo_lote),
    CONSTRAINT CK_Lote_Stock CHECK (stock_actual >= 0 AND stock_minimo >= 0)
);
GO
IF OBJECT_ID(N'dbo.Compra', N'U') IS NULL
CREATE TABLE dbo.Compra (
    compra_id        INT IDENTITY(1,1) CONSTRAINT PK_Compra PRIMARY KEY,
    proveedor_id     INT         NOT NULL,
    usuario_id       INT         NOT NULL,
    fecha            DATETIME2(0) NOT NULL CONSTRAINT DF_Compra_Fecha DEFAULT (SYSDATETIME()),
    numero_documento VARCHAR(40) NOT NULL,
    total            DECIMAL(14,2) NOT NULL CONSTRAINT DF_Compra_Total DEFAULT (0),
    CONSTRAINT FK_Compra_Proveedor FOREIGN KEY (proveedor_id) REFERENCES dbo.Proveedor(proveedor_id),
    CONSTRAINT FK_Compra_Usuario   FOREIGN KEY (usuario_id)   REFERENCES dbo.Usuario(usuario_id),
    CONSTRAINT UQ_Compra_Documento UNIQUE (proveedor_id, numero_documento),
    CONSTRAINT CK_Compra_Total CHECK (total >= 0)
);
GO
IF OBJECT_ID(N'dbo.DetalleCompra', N'U') IS NULL
CREATE TABLE dbo.DetalleCompra (
    detalle_compra_id INT IDENTITY(1,1) CONSTRAINT PK_DetalleCompra PRIMARY KEY,
    compra_id         INT NOT NULL,
    lote_id           INT NOT NULL,
    cantidad          INT NOT NULL,
    costo_unitario    DECIMAL(12,2) NOT NULL,
    subtotal AS CONVERT(DECIMAL(14,2), cantidad * costo_unitario) PERSISTED,
    CONSTRAINT FK_DetCompra_Compra FOREIGN KEY (compra_id) REFERENCES dbo.Compra(compra_id),
    CONSTRAINT FK_DetCompra_Lote   FOREIGN KEY (lote_id)   REFERENCES dbo.Lote(lote_id),
    CONSTRAINT CK_DetCompra_Cantidad CHECK (cantidad > 0),
    CONSTRAINT CK_DetCompra_Costo    CHECK (costo_unitario >= 0),
    CONSTRAINT UQ_DetCompra_CompraLote UNIQUE (compra_id, lote_id)
);
GO

/* ------------------------- 03. Ventas, trazabilidad y auditoria ------------------------- */
IF OBJECT_ID(N'dbo.Venta', N'U') IS NULL
CREATE TABLE dbo.Venta (
    venta_id           INT IDENTITY(1,1) CONSTRAINT PK_Venta PRIMARY KEY,
    cliente_id         INT          NOT NULL,
    usuario_id         INT          NOT NULL,
    receta_id          INT          NULL,
    fecha              DATETIME2(0) NOT NULL CONSTRAINT DF_Venta_Fecha DEFAULT (SYSDATETIME()),
    tipo_comprobante   VARCHAR(10)  NOT NULL,
    numero_comprobante VARCHAR(30)  NOT NULL,
    estado             VARCHAR(12)  NOT NULL CONSTRAINT DF_Venta_Estado DEFAULT ('CONFIRMADA'),
    total              DECIMAL(14,2) NOT NULL,
    fecha_anulacion        DATETIME2(0)  NULL,
    usuario_anulacion_id   INT           NULL,
    motivo_anulacion       NVARCHAR(250) NULL,
    CONSTRAINT FK_Venta_Cliente FOREIGN KEY (cliente_id) REFERENCES dbo.Cliente(cliente_id),
    CONSTRAINT FK_Venta_Usuario FOREIGN KEY (usuario_id) REFERENCES dbo.Usuario(usuario_id),
    CONSTRAINT FK_Venta_Receta  FOREIGN KEY (receta_id)  REFERENCES dbo.Receta(receta_id),
    CONSTRAINT FK_Venta_UsuarioAnula FOREIGN KEY (usuario_anulacion_id) REFERENCES dbo.Usuario(usuario_id),
    CONSTRAINT CK_Venta_Tipo   CHECK (tipo_comprobante IN ('BOLETA','FACTURA')),
    CONSTRAINT CK_Venta_Estado CHECK (estado IN ('CONFIRMADA','ANULADA')),
    CONSTRAINT CK_Venta_Total  CHECK (total >= 0),
    CONSTRAINT CK_Venta_Anulacion CHECK (
        (estado = 'CONFIRMADA' AND fecha_anulacion IS NULL AND usuario_anulacion_id IS NULL)
     OR (estado = 'ANULADA' AND fecha_anulacion IS NOT NULL AND usuario_anulacion_id IS NOT NULL)),
    CONSTRAINT UQ_Venta_Comprobante UNIQUE (tipo_comprobante, numero_comprobante)
);
GO
IF OBJECT_ID(N'dbo.DetalleVenta', N'U') IS NULL
CREATE TABLE dbo.DetalleVenta (
    detalle_venta_id INT IDENTITY(1,1) CONSTRAINT PK_DetalleVenta PRIMARY KEY,
    venta_id         INT NOT NULL,
    lote_id          INT NOT NULL,
    cantidad         INT NOT NULL,
    precio_unitario  DECIMAL(12,2) NOT NULL,
    subtotal AS CONVERT(DECIMAL(14,2), cantidad * precio_unitario) PERSISTED,
    CONSTRAINT FK_DetVenta_Venta FOREIGN KEY (venta_id) REFERENCES dbo.Venta(venta_id),
    CONSTRAINT FK_DetVenta_Lote  FOREIGN KEY (lote_id)  REFERENCES dbo.Lote(lote_id),
    CONSTRAINT CK_DetVenta_Cantidad CHECK (cantidad > 0),
    CONSTRAINT CK_DetVenta_Precio   CHECK (precio_unitario >= 0),
    CONSTRAINT UQ_DetVenta_VentaLote UNIQUE (venta_id, lote_id)
);
GO
IF OBJECT_ID(N'dbo.MovimientoStock', N'U') IS NULL
CREATE TABLE dbo.MovimientoStock (
    movimiento_id BIGINT IDENTITY(1,1) CONSTRAINT PK_MovimientoStock PRIMARY KEY,
    lote_id       INT         NOT NULL,
    usuario_id    INT         NOT NULL,
    compra_id     INT         NULL,
    venta_id      INT         NULL,
    tipo          VARCHAR(18) NOT NULL,
    cantidad      INT         NOT NULL,
    fecha         DATETIME2(0) NOT NULL CONSTRAINT DF_MovStock_Fecha DEFAULT (SYSDATETIME()),
    CONSTRAINT FK_Mov_Lote    FOREIGN KEY (lote_id)    REFERENCES dbo.Lote(lote_id),
    CONSTRAINT FK_Mov_Usuario FOREIGN KEY (usuario_id) REFERENCES dbo.Usuario(usuario_id),
    CONSTRAINT FK_Mov_Compra  FOREIGN KEY (compra_id)  REFERENCES dbo.Compra(compra_id),
    CONSTRAINT FK_Mov_Venta   FOREIGN KEY (venta_id)   REFERENCES dbo.Venta(venta_id),
    CONSTRAINT CK_Mov_Cantidad CHECK (cantidad > 0),
    CONSTRAINT CK_Mov_Tipo CHECK (tipo IN ('ENTRADA_COMPRA','SALIDA_VENTA','REVERSO_VENTA')),
    CONSTRAINT CK_Mov_Origen CHECK (
        (tipo = 'ENTRADA_COMPRA' AND compra_id IS NOT NULL AND venta_id IS NULL)
     OR (tipo IN ('SALIDA_VENTA','REVERSO_VENTA') AND venta_id IS NOT NULL AND compra_id IS NULL))
);
GO
IF OBJECT_ID(N'dbo.AuditoriaOperacion', N'U') IS NULL
CREATE TABLE dbo.AuditoriaOperacion (
    auditoria_id BIGINT IDENTITY(1,1) CONSTRAINT PK_AuditoriaOperacion PRIMARY KEY,
    usuario_id   INT          NULL,   -- NULL: intento de acceso sin usuario valido
    accion       VARCHAR(40)  NOT NULL,
    entidad      VARCHAR(40)  NOT NULL,
    entidad_id   INT          NULL,
    detalle      NVARCHAR(500) NULL,
    ip           VARCHAR(45)  NULL,
    fecha        DATETIME2(0) NOT NULL CONSTRAINT DF_Aud_Fecha DEFAULT (SYSDATETIME()),
    CONSTRAINT FK_Aud_Usuario FOREIGN KEY (usuario_id) REFERENCES dbo.Usuario(usuario_id)
);
GO

/* ------------------------- 04. Indices ------------------------- */
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_Medicamento_Nombre' AND object_id = OBJECT_ID(N'dbo.Medicamento'))
    CREATE INDEX IX_Medicamento_Nombre ON dbo.Medicamento(nombre);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_Cliente_Nombre' AND object_id = OBJECT_ID(N'dbo.Cliente'))
    CREATE INDEX IX_Cliente_Nombre ON dbo.Cliente(nombre_razon_social);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_Lote_Vencimiento' AND object_id = OBJECT_ID(N'dbo.Lote'))
    CREATE INDEX IX_Lote_Vencimiento ON dbo.Lote(fecha_vencimiento, medicamento_id);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_Venta_Fecha' AND object_id = OBJECT_ID(N'dbo.Venta'))
    CREATE INDEX IX_Venta_Fecha ON dbo.Venta(fecha, estado);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_DetVenta_Lote' AND object_id = OBJECT_ID(N'dbo.DetalleVenta'))
    CREATE INDEX IX_DetVenta_Lote ON dbo.DetalleVenta(lote_id);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_Mov_LoteFecha' AND object_id = OBJECT_ID(N'dbo.MovimientoStock'))
    CREATE INDEX IX_Mov_LoteFecha ON dbo.MovimientoStock(lote_id, fecha);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_Aud_Fecha' AND object_id = OBJECT_ID(N'dbo.AuditoriaOperacion'))
    CREATE INDEX IX_Aud_Fecha ON dbo.AuditoriaOperacion(fecha DESC);
-- Un movimiento por operacion y lote: la base impide duplicar salidas, entradas o reversos.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_Mov_Salida' AND object_id = OBJECT_ID(N'dbo.MovimientoStock'))
    CREATE UNIQUE INDEX UX_Mov_Salida ON dbo.MovimientoStock(venta_id, lote_id) WHERE tipo = 'SALIDA_VENTA';
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_Mov_Reverso' AND object_id = OBJECT_ID(N'dbo.MovimientoStock'))
    CREATE UNIQUE INDEX UX_Mov_Reverso ON dbo.MovimientoStock(venta_id, lote_id) WHERE tipo = 'REVERSO_VENTA';
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_Mov_Entrada' AND object_id = OBJECT_ID(N'dbo.MovimientoStock'))
    CREATE UNIQUE INDEX UX_Mov_Entrada ON dbo.MovimientoStock(compra_id, lote_id) WHERE tipo = 'ENTRADA_COMPRA';
GO

/* ------------------------- 05. Secuencias, tipos de tabla ------------------------- */
IF NOT EXISTS (SELECT 1 FROM sys.sequences WHERE name = N'seq_Boleta')
    CREATE SEQUENCE dbo.seq_Boleta AS BIGINT START WITH 1 INCREMENT BY 1;
IF NOT EXISTS (SELECT 1 FROM sys.sequences WHERE name = N'seq_Factura')
    CREATE SEQUENCE dbo.seq_Factura AS BIGINT START WITH 1 INCREMENT BY 1;
GO
IF TYPE_ID(N'dbo.TDetalleCompra') IS NULL
    CREATE TYPE dbo.TDetalleCompra AS TABLE (
        lote_id        INT NOT NULL PRIMARY KEY,
        cantidad       INT NOT NULL,
        costo_unitario DECIMAL(12,2) NOT NULL
    );
GO
IF TYPE_ID(N'dbo.TDetalleVenta') IS NULL
    CREATE TYPE dbo.TDetalleVenta AS TABLE (
        lote_id  INT NOT NULL PRIMARY KEY,
        cantidad INT NOT NULL
    );
GO

/* ------------------------- 06. Procedimientos transaccionales -------------------------
   Codigos de error de negocio (THROW):
     50001-50010 compras | 50011-50030 ventas | 50031-50040 anulaciones            */
CREATE OR ALTER PROCEDURE dbo.sp_RegistrarCompra
    @ProveedorId     INT,
    @UsuarioId       INT,
    @NumeroDocumento VARCHAR(40),
    @Items           dbo.TDetalleCompra READONLY,
    @Ip              VARCHAR(45) = NULL,
    @CompraId        INT OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    IF NOT EXISTS (SELECT 1 FROM dbo.Proveedor WHERE proveedor_id = @ProveedorId AND activo = 1)
        THROW 50004, N'Proveedor inexistente o inactivo.', 1;
    IF NOT EXISTS (SELECT 1 FROM dbo.Usuario WHERE usuario_id = @UsuarioId AND activo = 1)
        THROW 50005, N'Usuario inexistente o inactivo.', 1;
    IF NULLIF(LTRIM(RTRIM(@NumeroDocumento)), '') IS NULL
        THROW 50006, N'Se requiere numero de documento.', 1;
    IF NOT EXISTS (SELECT 1 FROM @Items)
        THROW 50001, N'La compra debe incluir al menos un lote.', 1;
    IF EXISTS (SELECT 1 FROM @Items WHERE cantidad <= 0 OR costo_unitario < 0)
        THROW 50002, N'Cantidad o costo no valido.', 1;
    IF EXISTS (SELECT 1 FROM dbo.Compra WHERE proveedor_id = @ProveedorId AND numero_documento = @NumeroDocumento)
        THROW 50008, N'Ya existe una compra con ese documento para el proveedor.', 1;

    BEGIN TRY
        BEGIN TRAN;
        DECLARE @Hoy DATE = CONVERT(DATE, SYSDATETIME());
        DECLARE @Bloqueados TABLE (lote_id INT PRIMARY KEY);
        INSERT @Bloqueados (lote_id)
            SELECT l.lote_id
            FROM dbo.Lote AS l WITH (UPDLOCK, HOLDLOCK)
            INNER JOIN @Items AS i ON i.lote_id = l.lote_id;
        IF (SELECT COUNT(*) FROM @Bloqueados) <> (SELECT COUNT(*) FROM @Items)
            THROW 50003, N'Existen lotes inexistentes.', 1;
        IF EXISTS (SELECT 1 FROM dbo.Lote AS l INNER JOIN @Items AS i ON i.lote_id = l.lote_id
                   WHERE l.fecha_vencimiento < @Hoy)
            THROW 50007, N'No se puede ingresar stock a un lote vencido.', 1;

        DECLARE @Total DECIMAL(14,2);
        SELECT @Total = SUM(CONVERT(DECIMAL(14,2), cantidad * costo_unitario)) FROM @Items;
        INSERT dbo.Compra (proveedor_id, usuario_id, numero_documento, total)
            VALUES (@ProveedorId, @UsuarioId, @NumeroDocumento, @Total);
        SET @CompraId = CONVERT(INT, SCOPE_IDENTITY());
        INSERT dbo.DetalleCompra (compra_id, lote_id, cantidad, costo_unitario)
            SELECT @CompraId, lote_id, cantidad, costo_unitario FROM @Items;
        UPDATE l SET stock_actual = l.stock_actual + i.cantidad
            FROM dbo.Lote AS l INNER JOIN @Items AS i ON i.lote_id = l.lote_id;
        INSERT dbo.MovimientoStock (lote_id, usuario_id, compra_id, tipo, cantidad)
            SELECT lote_id, @UsuarioId, @CompraId, 'ENTRADA_COMPRA', cantidad FROM @Items;
        INSERT dbo.AuditoriaOperacion (usuario_id, accion, entidad, entidad_id, detalle, ip)
            VALUES (@UsuarioId, 'COMPRA_REGISTRADA', 'Compra', @CompraId,
                    CONCAT(N'Documento ', @NumeroDocumento, N'; total S/ ', @Total), @Ip);
        COMMIT;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK;
        THROW;
    END CATCH
END;
GO

CREATE OR ALTER PROCEDURE dbo.sp_RegistrarVenta
    @ClienteId         INT,
    @UsuarioId         INT,
    @RecetaId          INT = NULL,
    @TipoComprobante   VARCHAR(10),
    @Items             dbo.TDetalleVenta READONLY,
    @Ip                VARCHAR(45) = NULL,
    @VentaId           INT OUTPUT,
    @NumeroComprobante VARCHAR(30) OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    IF NOT EXISTS (SELECT 1 FROM @Items)
        THROW 50011, N'La venta debe contener al menos un lote.', 1;
    IF EXISTS (SELECT 1 FROM @Items WHERE cantidad <= 0)
        THROW 50012, N'La cantidad debe ser mayor que cero.', 1;
    IF @TipoComprobante NOT IN ('BOLETA','FACTURA')
        THROW 50013, N'Tipo de comprobante no valido.', 1;
    IF NOT EXISTS (SELECT 1 FROM dbo.Cliente WHERE cliente_id = @ClienteId)
        THROW 50014, N'Cliente inexistente.', 1;
    IF NOT EXISTS (SELECT 1 FROM dbo.Usuario WHERE usuario_id = @UsuarioId AND activo = 1)
        THROW 50015, N'Usuario inexistente o inactivo.', 1;
    IF @TipoComprobante = 'FACTURA'
       AND NOT EXISTS (SELECT 1 FROM dbo.Cliente WHERE cliente_id = @ClienteId AND tipo_documento = 'RUC')
        THROW 50023, N'La factura requiere un cliente identificado con RUC.', 1;

    BEGIN TRY
        BEGIN TRAN;
        DECLARE @Hoy DATE = CONVERT(DATE, SYSDATETIME());
        -- Bloquea los lotes para impedir vender el mismo stock en paralelo.
        DECLARE @Bloqueados TABLE (lote_id INT PRIMARY KEY);
        INSERT @Bloqueados (lote_id)
            SELECT l.lote_id
            FROM dbo.Lote AS l WITH (UPDLOCK, HOLDLOCK)
            INNER JOIN @Items AS i ON i.lote_id = l.lote_id;
        IF (SELECT COUNT(*) FROM @Bloqueados) <> (SELECT COUNT(*) FROM @Items)
            THROW 50016, N'Existen lotes inexistentes.', 1;
        IF EXISTS (SELECT 1 FROM @Items AS i
                   INNER JOIN dbo.Lote AS l ON l.lote_id = i.lote_id
                   INNER JOIN dbo.Medicamento AS m ON m.medicamento_id = l.medicamento_id
                   WHERE m.activo = 0)
            THROW 50019, N'La venta incluye un medicamento inactivo.', 1;
        IF EXISTS (SELECT 1 FROM @Items AS i
                   INNER JOIN dbo.Lote AS l ON l.lote_id = i.lote_id
                   WHERE l.fecha_vencimiento < @Hoy)
            THROW 50020, N'No se pueden vender lotes vencidos.', 1;
        IF EXISTS (SELECT 1 FROM @Items AS i
                   INNER JOIN dbo.Lote AS l ON l.lote_id = i.lote_id
                   WHERE l.stock_actual < i.cantidad)
            THROW 50021, N'La cantidad supera las existencias disponibles del lote.', 1;
        -- Validacion de receta: registrada, valida, vigente y del mismo cliente.
        IF @RecetaId IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM dbo.Receta AS r
            WHERE r.receta_id = @RecetaId AND r.cliente_id = @ClienteId AND r.estado = 'VALIDA'
              AND r.fecha_emision <= @Hoy AND r.fecha_vencimiento >= @Hoy)
            THROW 50017, N'Receta no valida, no vigente o de otro cliente.', 1;
        IF @RecetaId IS NULL AND EXISTS (
            SELECT 1 FROM @Items AS i
            INNER JOIN dbo.Lote AS l ON l.lote_id = i.lote_id
            INNER JOIN dbo.Medicamento AS m ON m.medicamento_id = l.medicamento_id
            WHERE m.requiere_receta = 1)
            THROW 50018, N'Se requiere registrar receta para alguno de los productos.', 1;

        DECLARE @Total DECIMAL(14,2);
        SELECT @Total = SUM(CONVERT(DECIMAL(14,2), i.cantidad * m.precio_venta))
        FROM @Items AS i
        INNER JOIN dbo.Lote AS l ON l.lote_id = i.lote_id
        INNER JOIN dbo.Medicamento AS m ON m.medicamento_id = l.medicamento_id;

        DECLARE @Nro BIGINT;
        IF @TipoComprobante = 'BOLETA'
            SET @Nro = NEXT VALUE FOR dbo.seq_Boleta;
        ELSE
            SET @Nro = NEXT VALUE FOR dbo.seq_Factura;
        SET @NumeroComprobante = CONCAT(CASE WHEN @TipoComprobante = 'BOLETA' THEN 'B001-' ELSE 'F001-' END,
                                        RIGHT(CONCAT('000000', @Nro), 6));

        INSERT dbo.Venta (cliente_id, usuario_id, receta_id, tipo_comprobante, numero_comprobante, total)
            VALUES (@ClienteId, @UsuarioId, @RecetaId, @TipoComprobante, @NumeroComprobante, @Total);
        SET @VentaId = CONVERT(INT, SCOPE_IDENTITY());
        INSERT dbo.DetalleVenta (venta_id, lote_id, cantidad, precio_unitario)
            SELECT @VentaId, i.lote_id, i.cantidad, m.precio_venta
            FROM @Items AS i
            INNER JOIN dbo.Lote AS l ON l.lote_id = i.lote_id
            INNER JOIN dbo.Medicamento AS m ON m.medicamento_id = l.medicamento_id;
        UPDATE l SET stock_actual = l.stock_actual - i.cantidad
            FROM dbo.Lote AS l INNER JOIN @Items AS i ON i.lote_id = l.lote_id;
        INSERT dbo.MovimientoStock (lote_id, usuario_id, venta_id, tipo, cantidad)
            SELECT lote_id, @UsuarioId, @VentaId, 'SALIDA_VENTA', cantidad FROM @Items;
        INSERT dbo.AuditoriaOperacion (usuario_id, accion, entidad, entidad_id, detalle, ip)
            VALUES (@UsuarioId, 'VENTA_REGISTRADA', 'Venta', @VentaId,
                    CONCAT(N'Comprobante ', @NumeroComprobante, N'; total S/ ', @Total), @Ip);
        COMMIT;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK;
        THROW;
    END CATCH
END;
GO

CREATE OR ALTER PROCEDURE dbo.sp_AnularVenta
    @VentaId   INT,
    @UsuarioId INT,
    @Motivo    NVARCHAR(250),
    @Ip        VARCHAR(45) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    IF NULLIF(LTRIM(RTRIM(@Motivo)), N'') IS NULL
        THROW 50034, N'Se requiere el motivo de la anulacion.', 1;
    IF NOT EXISTS (SELECT 1 FROM dbo.Usuario AS u INNER JOIN dbo.Rol AS r ON r.rol_id = u.rol_id
                   WHERE u.usuario_id = @UsuarioId AND u.activo = 1 AND r.nombre = N'Administrador')
        THROW 50033, N'Solo un administrador activo puede anular ventas.', 1;
    BEGIN TRY
        BEGIN TRAN;
        DECLARE @Estado VARCHAR(12);
        -- Serializa solicitudes simultaneas de anulacion de la misma venta.
        SELECT @Estado = estado FROM dbo.Venta WITH (UPDLOCK, HOLDLOCK) WHERE venta_id = @VentaId;
        IF @Estado IS NULL
            THROW 50031, N'La venta no existe.', 1;
        IF @Estado <> 'CONFIRMADA'
            THROW 50032, N'La venta ya esta anulada.', 1;
        UPDATE l SET stock_actual = l.stock_actual + d.cantidad
            FROM dbo.Lote AS l INNER JOIN dbo.DetalleVenta AS d ON d.lote_id = l.lote_id
            WHERE d.venta_id = @VentaId;
        INSERT dbo.MovimientoStock (lote_id, usuario_id, venta_id, tipo, cantidad)
            SELECT lote_id, @UsuarioId, @VentaId, 'REVERSO_VENTA', cantidad
            FROM dbo.DetalleVenta WHERE venta_id = @VentaId;
        UPDATE dbo.Venta
            SET estado = 'ANULADA', fecha_anulacion = SYSDATETIME(),
                usuario_anulacion_id = @UsuarioId, motivo_anulacion = @Motivo
            WHERE venta_id = @VentaId;
        INSERT dbo.AuditoriaOperacion (usuario_id, accion, entidad, entidad_id, detalle, ip)
            VALUES (@UsuarioId, 'VENTA_ANULADA', 'Venta', @VentaId, LEFT(@Motivo, 500), @Ip);
        COMMIT;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK;
        THROW;
    END CATCH
END;
GO

/* ------------------------- 07. Vistas de consulta y reportes ------------------------- */
CREATE OR ALTER VIEW dbo.vw_StockMedicamento
AS
SELECT m.medicamento_id, m.sku, m.nombre,
       COALESCE(SUM(CASE WHEN l.fecha_vencimiento >= CONVERT(DATE, SYSDATETIME()) THEN l.stock_actual END), 0) AS stock_vendible,
       COALESCE(SUM(CASE WHEN l.fecha_vencimiento <  CONVERT(DATE, SYSDATETIME()) THEN l.stock_actual END), 0) AS stock_vencido
FROM dbo.Medicamento AS m
LEFT JOIN dbo.Lote AS l ON l.medicamento_id = m.medicamento_id
GROUP BY m.medicamento_id, m.sku, m.nombre;
GO
CREATE OR ALTER VIEW dbo.vw_AlertasLote
AS
SELECT x.lote_id, x.sku, x.nombre, x.codigo_lote, x.fecha_vencimiento, x.stock_actual, x.stock_minimo, x.alerta
FROM (
    SELECT l.lote_id, m.sku, m.nombre, l.codigo_lote, l.fecha_vencimiento, l.stock_actual, l.stock_minimo,
           CASE
               WHEN l.stock_actual > 0 AND l.fecha_vencimiento < CONVERT(DATE, SYSDATETIME()) THEN 'VENCIDO'
               WHEN l.stock_actual = 0 AND l.fecha_vencimiento >= CONVERT(DATE, SYSDATETIME()) THEN 'AGOTADO'
               WHEN l.stock_actual > 0 AND l.fecha_vencimiento <= DATEADD(DAY, 30, CONVERT(DATE, SYSDATETIME())) THEN 'POR_VENCER'
               WHEN l.stock_actual > 0 AND l.stock_actual <= l.stock_minimo THEN 'STOCK_BAJO'
           END AS alerta
    FROM dbo.Lote AS l
    INNER JOIN dbo.Medicamento AS m ON m.medicamento_id = l.medicamento_id
    WHERE m.activo = 1
) AS x
WHERE x.alerta IS NOT NULL;
GO
CREATE OR ALTER VIEW dbo.vw_VentasDiarias
AS
SELECT CONVERT(DATE, fecha) AS fecha_venta, COUNT(*) AS numero_ventas, SUM(total) AS importe_total
FROM dbo.Venta WHERE estado = 'CONFIRMADA'
GROUP BY CONVERT(DATE, fecha);
GO
CREATE OR ALTER VIEW dbo.vw_Kardex
AS
SELECT mv.movimiento_id, mv.fecha, mv.tipo, mv.cantidad, mv.lote_id, l.codigo_lote,
       m.sku, m.nombre AS medicamento, mv.compra_id, mv.venta_id, u.nombres AS usuario
FROM dbo.MovimientoStock AS mv
INNER JOIN dbo.Lote AS l ON l.lote_id = mv.lote_id
INNER JOIN dbo.Medicamento AS m ON m.medicamento_id = l.medicamento_id
INNER JOIN dbo.Usuario AS u ON u.usuario_id = mv.usuario_id;
GO
CREATE OR ALTER VIEW dbo.vw_VentaDetalle
AS
SELECT v.venta_id, v.numero_comprobante, v.tipo_comprobante, v.fecha, v.estado,
       c.nombre_razon_social AS cliente, d.lote_id, l.codigo_lote, m.nombre AS medicamento,
       d.cantidad, d.precio_unitario, d.subtotal
FROM dbo.Venta AS v
INNER JOIN dbo.Cliente AS c ON c.cliente_id = v.cliente_id
INNER JOIN dbo.DetalleVenta AS d ON d.venta_id = v.venta_id
INNER JOIN dbo.Lote AS l ON l.lote_id = d.lote_id
INNER JOIN dbo.Medicamento AS m ON m.medicamento_id = l.medicamento_id;
GO

/* ------------------------- 08. Datos de demostracion -------------------------
   Fechas relativas a la fecha de ejecucion para que las alertas siempre
   muestren estados reales. Usuarios: ver README.md (credenciales de PRUEBA). */
IF NOT EXISTS (SELECT 1 FROM dbo.Rol)
BEGIN
    DECLARE @Hoy DATE = CONVERT(DATE, SYSDATETIME());

    INSERT dbo.Rol (nombre, descripcion) VALUES
        (N'Administrador',        N'Gestiona usuarios, reportes, anulaciones y configuracion'),
        (N'Cajero',               N'Registra ventas y clientes'),
        (N'Almacenero',           N'Recepciona compras, lotes y proveedores'),
        (N'Quimico farmaceutico', N'Verifica recetas y supervisa medicamentos');

    INSERT dbo.Usuario (rol_id, nombres, correo, hash_contrasena) VALUES
        (1, N'Ana Administradora',  N'admin@farmacontrol.local',   N'scrypt$16384$8$1$iIxy8x5jCBXznK6Ss69PfQ==$jXlwzNwFhnphvVjIs3E6ccXmrG37yxsMzEstyxaRbiCrOjOk4wbdRjTXvAWIAErR7UezYd4IWnoVF8nF3LYPRg=='),
        (2, N'Carlos Cajero',       N'cajero@farmacontrol.local',  N'scrypt$16384$8$1$uUht8cVNcBPsvB7LeVog8w==$0P7dZccbABkEdz3u4mLok5ZgpsRML9boq7dnLd5ZlwjBkI7VVVpnyNY2xqUSIBHqjFL0N4Ta1aHRD0WF4iyhaA=='),
        (3, N'Alicia Almacenera',   N'almacen@farmacontrol.local', N'scrypt$16384$8$1$3zMV6N2yaNiKv0kZEdRkcg==$wcyhyhGKVX735+mT8TVuXKEeWIDmSth6Q54y2c+0rovwHqf0NwzgD37TkbAGD06cVW4ZxZ+7bj/w+b8ATUbGhA=='),
        (4, N'Quimica Quispe',      N'quimico@farmacontrol.local', N'scrypt$16384$8$1$iUWcQhqV+FufQNDie2U6TA==$pTKCb+gqL77+C+Bk6HNEmpZLQYaSv7Ix5/eSraFubPlxKwK+WnqJrSyBIseGK/GUctVYgkCcuw9mFu8E4eb1mw==');

    INSERT dbo.Categoria (nombre) VALUES
        (N'Analgesicos'), (N'Antialergicos'), (N'Antibioticos'), (N'Cuidado personal');

    INSERT dbo.Medicamento (categoria_id, sku, nombre, principio_activo, presentacion, precio_venta, requiere_receta) VALUES
        (1, 'MED-001', N'Paracetamol 500 mg',      N'Paracetamol',  N'Caja x 20 tabletas',  8.50, 0),
        (2, 'MED-002', N'Cetirizina 10 mg',        N'Cetirizina',   N'Caja x 10 tabletas', 12.90, 0),
        (4, 'MED-003', N'Alcohol en gel 250 ml',   NULL,            N'Frasco 250 ml',       9.90, 0),
        (3, 'MED-004', N'Amoxicilina 500 mg',      N'Amoxicilina',  N'Caja x 21 capsulas', 21.50, 1),
        (4, 'MED-005', N'Suero fisiologico 500 ml',N'Cloruro de sodio', N'Bolsa 500 ml',    7.20, 0),
        (1, 'MED-006', N'Ibuprofeno 400 mg',       N'Ibuprofeno',   N'Caja x 10 tabletas', 11.00, 0),
        (2, 'MED-007', N'Loratadina 10 mg',        N'Loratadina',   N'Caja x 10 tabletas',  6.80, 0),
        (3, 'MED-008', N'Azitromicina 500 mg',     N'Azitromicina', N'Caja x 3 tabletas',  24.90, 1);

    INSERT dbo.Lote (medicamento_id, codigo_lote, fecha_vencimiento, stock_minimo) VALUES
        (1, N'P-2401',  DATEADD(DAY, 600, @Hoy), 15),
        (1, N'P-2402',  DATEADD(DAY,  20, @Hoy), 15),
        (2, N'C-1822',  DATEADD(DAY, 500, @Hoy), 20),
        (3, N'AG-830',  DATEADD(DAY, 300, @Hoy), 12),
        (4, N'AM-705',  DATEADD(DAY, 240, @Hoy), 10),
        (5, N'SF-401',  DATEADD(DAY, 400, @Hoy), 12),
        (6, N'IB-310',  DATEADD(DAY, 365, @Hoy), 10),
        (7, N'LO-114',  DATEADD(DAY, 700, @Hoy), 10),
        (8, N'AZ-220',  DATEADD(DAY, 180, @Hoy),  5);

    INSERT dbo.Cliente (tipo_documento, numero_documento, nombre_razon_social, telefono) VALUES
        ('DNI', '12345678',    N'Maria Torres',                '999 111 222'),
        ('DNI', '45678912',    N'Luis Paredes',                '988 333 444'),
        ('RUC', '20600000003', N'Clinica Los Andes SAC (ficticia)', '014 555 000');

    INSERT dbo.Proveedor (ruc, razon_social, contacto, telefono) VALUES
        ('20600000001', N'Distribuidora Salud Peru SAC (ficticio)',   N'Area comercial', '014 100 100'),
        ('20600000002', N'Logistica Medica Andina SAC (ficticio)',    N'Area comercial', '014 200 200');

    INSERT dbo.Receta (cliente_id, numero_receta, nombre_prescriptor, fecha_emision, fecha_vencimiento, observacion) VALUES
        (1, 'REC-00041', N'Dr. Carlos Rios (ficticio)', DATEADD(DAY, -3, @Hoy),  DATEADD(DAY, 27, @Hoy),  N'Receta vigente de demostracion'),
        (2, 'REC-00012', N'Dra. Rosa Medina (ficticia)', DATEADD(DAY, -60, @Hoy), DATEADD(DAY, -30, @Hoy), N'Receta vencida de demostracion');

    -- Stock inicial mediante compras reales (genera movimientos ENTRADA_COMPRA).
    DECLARE @c dbo.TDetalleCompra, @cid INT;
    INSERT @c (lote_id, cantidad, costo_unitario)
        SELECT lote_id, 120, 4.20 FROM dbo.Lote WHERE codigo_lote = N'P-2401' UNION ALL
        SELECT lote_id,  30, 4.20 FROM dbo.Lote WHERE codigo_lote = N'P-2402' UNION ALL
        SELECT lote_id,  24, 7.00 FROM dbo.Lote WHERE codigo_lote = N'C-1822' UNION ALL
        SELECT lote_id,  60, 4.80 FROM dbo.Lote WHERE codigo_lote = N'AG-830' UNION ALL
        SELECT lote_id,  40, 12.00 FROM dbo.Lote WHERE codigo_lote = N'AM-705' UNION ALL
        SELECT lote_id,   8, 3.50 FROM dbo.Lote WHERE codigo_lote = N'SF-401' UNION ALL
        SELECT lote_id,  50, 6.00 FROM dbo.Lote WHERE codigo_lote = N'IB-310' UNION ALL
        SELECT lote_id,   8, 14.00 FROM dbo.Lote WHERE codigo_lote = N'AZ-220';
    EXEC dbo.sp_RegistrarCompra @ProveedorId = 1, @UsuarioId = 3, @NumeroDocumento = 'FAC-2026-0001',
         @Items = @c, @Ip = NULL, @CompraId = @cid OUTPUT;

    -- Ventas de demostracion mediante el procedimiento (stock y movimientos coherentes).
    DECLARE @v dbo.TDetalleVenta, @vid INT, @nro VARCHAR(30);
    INSERT @v (lote_id, cantidad)
        SELECT lote_id, 2 FROM dbo.Lote WHERE codigo_lote = N'P-2401' UNION ALL
        SELECT lote_id, 4 FROM dbo.Lote WHERE codigo_lote = N'C-1822';
    EXEC dbo.sp_RegistrarVenta @ClienteId = 1, @UsuarioId = 2, @RecetaId = NULL, @TipoComprobante = 'BOLETA',
         @Items = @v, @Ip = NULL, @VentaId = @vid OUTPUT, @NumeroComprobante = @nro OUTPUT;

    DELETE FROM @v;
    INSERT @v (lote_id, cantidad) SELECT lote_id, 2 FROM dbo.Lote WHERE codigo_lote = N'AM-705';
    EXEC dbo.sp_RegistrarVenta @ClienteId = 1, @UsuarioId = 2, @RecetaId = 1, @TipoComprobante = 'BOLETA',
         @Items = @v, @Ip = NULL, @VentaId = @vid OUTPUT, @NumeroComprobante = @nro OUTPUT;

    DELETE FROM @v;
    INSERT @v (lote_id, cantidad) SELECT lote_id, 3 FROM dbo.Lote WHERE codigo_lote = N'IB-310';
    EXEC dbo.sp_RegistrarVenta @ClienteId = 2, @UsuarioId = 2, @RecetaId = NULL, @TipoComprobante = 'BOLETA',
         @Items = @v, @Ip = NULL, @VentaId = @vid OUTPUT, @NumeroComprobante = @nro OUTPUT;
    EXEC dbo.sp_AnularVenta @VentaId = @vid, @UsuarioId = 1, @Motivo = N'Anulacion de demostracion', @Ip = NULL;

    -- Simula el paso del tiempo: el lote SF-401 vencio despues de recibirse (alerta VENCIDO).
    UPDATE dbo.Lote SET fecha_vencimiento = DATEADD(DAY, -5, @Hoy) WHERE codigo_lote = N'SF-401';
END;
GO
PRINT N'FarmaControlBD lista: 14 tablas, 3 procedimientos, 5 vistas y datos de demostracion.';
GO
