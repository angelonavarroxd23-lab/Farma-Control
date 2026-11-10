/* ================================================================
   FarmaControl | SQL Server 2019+
   Sistema academico de gestion de ventas de farmacia (datos ficticios)
   Ejecutar en SQL Server Management Studio sobre una instalacion nueva.
   NOTA: script de CREACION, no de actualizacion; no elimina datos.
   Seguridad: la autenticacion y el hash seguro de contrasenas deben
   implementarse en una aplicacion real (Argon2id/bcrypt), no en T-SQL.
   Las boletas/facturas son comprobantes SIMULADOS, sin integracion SUNAT.
   ================================================================ */
IF DB_ID(N'FarmaControlBD') IS NULL
    CREATE DATABASE FarmaControlBD;
GO
USE FarmaControlBD;
GO

-- 01. Usuarios y catalogos
CREATE TABLE dbo.Rol (
    rol_id INT IDENTITY(1,1) PRIMARY KEY,
    nombre NVARCHAR(40) NOT NULL UNIQUE,
    descripcion NVARCHAR(180) NULL
);
CREATE TABLE dbo.Usuario (
    usuario_id INT IDENTITY(1,1) PRIMARY KEY,
    rol_id INT NOT NULL,
    nombres NVARCHAR(120) NOT NULL,
    correo NVARCHAR(160) NOT NULL UNIQUE,
    hash_contrasena NVARCHAR(255) NOT NULL,
    activo BIT NOT NULL CONSTRAINT DF_Usuario_Activo DEFAULT (1),
    CONSTRAINT FK_Usuario_Rol FOREIGN KEY (rol_id) REFERENCES dbo.Rol(rol_id)
);
CREATE TABLE dbo.Cliente (
    cliente_id INT IDENTITY(1,1) PRIMARY KEY,
    tipo_documento VARCHAR(3) NOT NULL,
    numero_documento VARCHAR(15) NOT NULL,
    nombre_razon_social NVARCHAR(160) NOT NULL,
    telefono VARCHAR(20) NULL,
    CONSTRAINT CK_Cliente_TipoDoc CHECK (tipo_documento IN ('DNI','CE','RUC','OTR')),
    CONSTRAINT UQ_Cliente_Doc UNIQUE (tipo_documento, numero_documento)
);
CREATE TABLE dbo.Proveedor (
    proveedor_id INT IDENTITY(1,1) PRIMARY KEY,
    ruc CHAR(11) NOT NULL UNIQUE,
    razon_social NVARCHAR(180) NOT NULL,
    contacto NVARCHAR(120) NULL,
    telefono VARCHAR(20) NULL,
    activo BIT NOT NULL CONSTRAINT DF_Proveedor_Activo DEFAULT (1),
    CONSTRAINT CK_Proveedor_RUC CHECK (ruc NOT LIKE '%[^0-9]%')
);
CREATE TABLE dbo.Categoria (
    categoria_id INT IDENTITY(1,1) PRIMARY KEY,
    nombre NVARCHAR(90) NOT NULL UNIQUE
);
CREATE TABLE dbo.Medicamento (
    medicamento_id INT IDENTITY(1,1) PRIMARY KEY,
    categoria_id INT NOT NULL,
    sku VARCHAR(30) NOT NULL UNIQUE,
    nombre NVARCHAR(160) NOT NULL,
    principio_activo NVARCHAR(160) NULL,
    presentacion NVARCHAR(90) NOT NULL,
    precio_venta DECIMAL(12,2) NOT NULL,
    requiere_receta BIT NOT NULL CONSTRAINT DF_Medicamento_Receta DEFAULT (0),
    activo BIT NOT NULL CONSTRAINT DF_Medicamento_Activo DEFAULT (1),
    CONSTRAINT CK_Medicamento_Precio CHECK (precio_venta >= 0),
    CONSTRAINT FK_Medicamento_Categoria FOREIGN KEY (categoria_id)
        REFERENCES dbo.Categoria(categoria_id)
);

-- 02. Recetas, lotes y compras
CREATE TABLE dbo.Receta (
    receta_id INT IDENTITY(1,1) PRIMARY KEY,
    cliente_id INT NOT NULL,
    numero_receta VARCHAR(50) NOT NULL UNIQUE,
    nombre_prescriptor NVARCHAR(160) NOT NULL,
    fecha_emision DATE NOT NULL,
    fecha_vencimiento DATE NOT NULL,
    estado VARCHAR(12) NOT NULL CONSTRAINT DF_Receta_Estado DEFAULT ('VALIDA'),
    observacion NVARCHAR(250) NULL,
    CONSTRAINT FK_Receta_Cliente FOREIGN KEY (cliente_id)
        REFERENCES dbo.Cliente(cliente_id),
    CONSTRAINT CK_Receta_Fechas CHECK (fecha_vencimiento >= fecha_emision),
    CONSTRAINT CK_Receta_Estado CHECK (estado IN ('VALIDA','ANULADA'))
);
CREATE TABLE dbo.Lote (
    lote_id INT IDENTITY(1,1) PRIMARY KEY,
    medicamento_id INT NOT NULL,
    codigo_lote NVARCHAR(60) NOT NULL,
    fecha_vencimiento DATE NOT NULL,
    stock_actual INT NOT NULL CONSTRAINT DF_Lote_Stock DEFAULT (0),
    stock_minimo INT NOT NULL CONSTRAINT DF_Lote_Minimo DEFAULT (5),
    CONSTRAINT FK_Lote_Medicamento FOREIGN KEY (medicamento_id)
        REFERENCES dbo.Medicamento(medicamento_id),
    CONSTRAINT UQ_Lote_Codigo UNIQUE (medicamento_id, codigo_lote),
    CONSTRAINT CK_Lote_Stock CHECK (stock_actual >= 0 AND stock_minimo >= 0)
);
CREATE TABLE dbo.Compra (
    compra_id INT IDENTITY(1,1) PRIMARY KEY,
    proveedor_id INT NOT NULL,
    usuario_id INT NOT NULL,
    fecha DATETIME2(0) NOT NULL CONSTRAINT DF_Compra_Fecha DEFAULT (SYSDATETIME()),
    numero_documento VARCHAR(40) NOT NULL,
    total DECIMAL(14,2) NOT NULL CONSTRAINT DF_Compra_Total DEFAULT (0),
    CONSTRAINT FK_Compra_Proveedor FOREIGN KEY (proveedor_id)
        REFERENCES dbo.Proveedor(proveedor_id),
    CONSTRAINT FK_Compra_Usuario FOREIGN KEY (usuario_id)
        REFERENCES dbo.Usuario(usuario_id),
    CONSTRAINT UQ_Compra_Documento UNIQUE (proveedor_id, numero_documento),
    CONSTRAINT CK_Compra_Total CHECK (total >= 0)
);
CREATE TABLE dbo.DetalleCompra (
    detalle_compra_id INT IDENTITY(1,1) PRIMARY KEY,
    compra_id INT NOT NULL,
    lote_id INT NOT NULL,
    cantidad INT NOT NULL,
    costo_unitario DECIMAL(12,2) NOT NULL,
    subtotal AS CONVERT(DECIMAL(14,2), cantidad * costo_unitario) PERSISTED,
    CONSTRAINT FK_DetCompra_Compra FOREIGN KEY (compra_id)
        REFERENCES dbo.Compra(compra_id),
    CONSTRAINT FK_DetCompra_Lote FOREIGN KEY (lote_id)
        REFERENCES dbo.Lote(lote_id),
    CONSTRAINT CK_DetCompra_Cantidad CHECK (cantidad > 0),
    CONSTRAINT CK_DetCompra_Costo CHECK (costo_unitario >= 0),
    CONSTRAINT UQ_DetCompra_CompraLote UNIQUE (compra_id, lote_id)
);

-- 03. Ventas, detalle y trazabilidad
CREATE TABLE dbo.Venta (
    venta_id INT IDENTITY(1,1) PRIMARY KEY,
    cliente_id INT NOT NULL,
    usuario_id INT NOT NULL,
    receta_id INT NULL,
    fecha DATETIME2(0) NOT NULL CONSTRAINT DF_Venta_Fecha DEFAULT (SYSDATETIME()),
    tipo_comprobante VARCHAR(10) NOT NULL,
    numero_comprobante VARCHAR(30) NOT NULL,
    estado VARCHAR(12) NOT NULL CONSTRAINT DF_Venta_Estado DEFAULT ('CONFIRMADA'),
    total DECIMAL(14,2) NOT NULL,
    CONSTRAINT FK_Venta_Cliente FOREIGN KEY (cliente_id) REFERENCES dbo.Cliente(cliente_id),
    CONSTRAINT FK_Venta_Usuario FOREIGN KEY (usuario_id) REFERENCES dbo.Usuario(usuario_id),
    CONSTRAINT FK_Venta_Receta FOREIGN KEY (receta_id) REFERENCES dbo.Receta(receta_id),
    CONSTRAINT CK_Venta_Tipo CHECK (tipo_comprobante IN ('BOLETA','FACTURA')),
    CONSTRAINT CK_Venta_Estado CHECK (estado IN ('CONFIRMADA','ANULADA')),
    CONSTRAINT CK_Venta_Total CHECK (total >= 0),
    CONSTRAINT UQ_Venta_Comprobante UNIQUE (tipo_comprobante, numero_comprobante)
);
CREATE TABLE dbo.DetalleVenta (
    detalle_venta_id INT IDENTITY(1,1) PRIMARY KEY,
    venta_id INT NOT NULL,
    lote_id INT NOT NULL,
    cantidad INT NOT NULL,
    precio_unitario DECIMAL(12,2) NOT NULL,
    subtotal AS CONVERT(DECIMAL(14,2), cantidad * precio_unitario) PERSISTED,
    CONSTRAINT FK_DetVenta_Venta FOREIGN KEY (venta_id) REFERENCES dbo.Venta(venta_id),
    CONSTRAINT FK_DetVenta_Lote FOREIGN KEY (lote_id) REFERENCES dbo.Lote(lote_id),
    CONSTRAINT CK_DetVenta_Cantidad CHECK (cantidad > 0),
    CONSTRAINT CK_DetVenta_Precio CHECK (precio_unitario >= 0),
    CONSTRAINT UQ_DetVenta_VentaLote UNIQUE (venta_id, lote_id)
);
CREATE TABLE dbo.MovimientoStock (
    movimiento_id BIGINT IDENTITY(1,1) PRIMARY KEY,
    lote_id INT NOT NULL,
    usuario_id INT NOT NULL,
    compra_id INT NULL,
    venta_id INT NULL,
    tipo VARCHAR(18) NOT NULL,
    cantidad INT NOT NULL,
    fecha DATETIME2(0) NOT NULL CONSTRAINT DF_MovStock_Fecha DEFAULT (SYSDATETIME()),
    CONSTRAINT FK_Mov_Lote FOREIGN KEY (lote_id) REFERENCES dbo.Lote(lote_id),
    CONSTRAINT FK_Mov_Usuario FOREIGN KEY (usuario_id) REFERENCES dbo.Usuario(usuario_id),
    CONSTRAINT FK_Mov_Compra FOREIGN KEY (compra_id) REFERENCES dbo.Compra(compra_id),
    CONSTRAINT FK_Mov_Venta FOREIGN KEY (venta_id) REFERENCES dbo.Venta(venta_id),
    CONSTRAINT CK_Mov_Cantidad CHECK (cantidad > 0),
    CONSTRAINT CK_Mov_Tipo CHECK (tipo IN ('ENTRADA_COMPRA','SALIDA_VENTA','REVERSO_VENTA')),
    CONSTRAINT CK_Mov_Origen CHECK (
        (tipo = 'ENTRADA_COMPRA' AND compra_id IS NOT NULL AND venta_id IS NULL)
        OR (tipo IN ('SALIDA_VENTA','REVERSO_VENTA') AND venta_id IS NOT NULL AND compra_id IS NULL)
    )
);
GO

-- Indices para busqueda, trazabilidad y consultas operativas
CREATE INDEX IX_Medicamento_Nombre ON dbo.Medicamento(nombre);
CREATE INDEX IX_Lote_Vencimiento ON dbo.Lote(fecha_vencimiento, medicamento_id);
CREATE INDEX IX_Venta_Fecha ON dbo.Venta(fecha, estado);
CREATE INDEX IX_DetVenta_Lote ON dbo.DetalleVenta(lote_id);
CREATE INDEX IX_Mov_LoteFecha ON dbo.MovimientoStock(lote_id, fecha);
GO

-- Tipos de tabla para operaciones atomicas: una fila por lote.
CREATE TYPE dbo.TDetalleCompra AS TABLE (
    lote_id INT NOT NULL PRIMARY KEY,
    cantidad INT NOT NULL,
    costo_unitario DECIMAL(12,2) NOT NULL
);
GO
CREATE TYPE dbo.TDetalleVenta AS TABLE (
    lote_id INT NOT NULL PRIMARY KEY,
    cantidad INT NOT NULL
);
GO

CREATE OR ALTER PROCEDURE dbo.sp_RegistrarCompra
    @ProveedorId INT,
    @UsuarioId INT,
    @NumeroDocumento VARCHAR(40),
    @Items dbo.TDetalleCompra READONLY,
    @CompraId INT OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    IF NOT EXISTS (SELECT 1 FROM dbo.Proveedor WHERE proveedor_id = @ProveedorId AND activo = 1)
        THROW 50004, 'Proveedor inexistente o inactivo.', 1;
    IF NOT EXISTS (SELECT 1 FROM dbo.Usuario WHERE usuario_id = @UsuarioId AND activo = 1)
        THROW 50005, 'Usuario inexistente o inactivo.', 1;
    IF NULLIF(LTRIM(RTRIM(@NumeroDocumento)), '') IS NULL
        THROW 50006, 'Se requiere numero de documento.', 1;
    IF NOT EXISTS (SELECT 1 FROM @Items)
        THROW 50001, 'La compra debe incluir al menos un lote.', 1;
    IF EXISTS (SELECT 1 FROM @Items WHERE cantidad <= 0 OR costo_unitario < 0)
        THROW 50002, 'Cantidad o costo no valido.', 1;
    IF EXISTS (SELECT 1 FROM @Items i LEFT JOIN dbo.Lote l ON i.lote_id = l.lote_id
               WHERE l.lote_id IS NULL)
        THROW 50003, 'Existen lotes inexistentes.', 1;

    BEGIN TRY
        BEGIN TRAN;
        DECLARE @Total DECIMAL(14,2);
        SELECT @Total = SUM(CONVERT(DECIMAL(14,2), cantidad * costo_unitario)) FROM @Items;
        INSERT dbo.Compra(proveedor_id, usuario_id, numero_documento, total)
        VALUES (@ProveedorId, @UsuarioId, @NumeroDocumento, @Total);
        SET @CompraId = CONVERT(INT, SCOPE_IDENTITY());
        INSERT dbo.DetalleCompra(compra_id, lote_id, cantidad, costo_unitario)
            SELECT @CompraId, lote_id, cantidad, costo_unitario FROM @Items;
        UPDATE l SET stock_actual = l.stock_actual + i.cantidad
          FROM dbo.Lote AS l INNER JOIN @Items AS i ON i.lote_id = l.lote_id;
        INSERT dbo.MovimientoStock(lote_id, usuario_id, compra_id, tipo, cantidad)
            SELECT lote_id, @UsuarioId, @CompraId, 'ENTRADA_COMPRA', cantidad FROM @Items;
        COMMIT;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK;
        THROW;
    END CATCH
END;
GO

CREATE OR ALTER PROCEDURE dbo.sp_RegistrarVenta
    @ClienteId INT,
    @UsuarioId INT,
    @RecetaId INT = NULL,
    @TipoComprobante VARCHAR(10),
    @NumeroComprobante VARCHAR(30),
    @Items dbo.TDetalleVenta READONLY,
    @VentaId INT OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    IF NOT EXISTS (SELECT 1 FROM @Items)
        THROW 50011, 'La venta debe contener al menos un lote.', 1;
    IF EXISTS (SELECT 1 FROM @Items WHERE cantidad <= 0)
        THROW 50012, 'La cantidad debe ser mayor que cero.', 1;
    IF @TipoComprobante NOT IN ('BOLETA','FACTURA')
        THROW 50013, 'Tipo de comprobante no valido.', 1;
    IF NOT EXISTS (SELECT 1 FROM dbo.Cliente WHERE cliente_id = @ClienteId)
        THROW 50014, 'Cliente inexistente.', 1;
    IF NOT EXISTS (SELECT 1 FROM dbo.Usuario WHERE usuario_id = @UsuarioId AND activo = 1)
        THROW 50015, 'Usuario inexistente o inactivo.', 1;

    BEGIN TRY
        BEGIN TRAN;
        -- Bloquea lotes para impedir vender el mismo stock en paralelo.
        IF EXISTS (
            SELECT 1 FROM @Items i
            LEFT JOIN dbo.Lote l WITH (UPDLOCK, HOLDLOCK) ON l.lote_id = i.lote_id
            LEFT JOIN dbo.Medicamento m ON m.medicamento_id = l.medicamento_id
            WHERE l.lote_id IS NULL OR m.activo = 0
               OR l.stock_actual < i.cantidad
               OR l.fecha_vencimiento < CONVERT(DATE, SYSDATETIME())
        ) THROW 50016, 'Lote inexistente, vencido, inactivo o sin stock.', 1;
        -- Validacion simplificada: receta registrada, vigente y del mismo cliente.
        IF @RecetaId IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM dbo.Receta r
            WHERE r.receta_id = @RecetaId AND r.cliente_id = @ClienteId
              AND r.estado = 'VALIDA' AND r.fecha_emision <= CONVERT(DATE, SYSDATETIME())
              AND r.fecha_vencimiento >= CONVERT(DATE, SYSDATETIME())
        ) THROW 50017, 'Receta no valida, no vigente o de otro cliente.', 1;
        IF @RecetaId IS NULL AND EXISTS (
            SELECT 1 FROM @Items i
            JOIN dbo.Lote l ON l.lote_id = i.lote_id
            JOIN dbo.Medicamento m ON m.medicamento_id = l.medicamento_id
            WHERE m.requiere_receta = 1
        ) THROW 50018, 'Se requiere registrar receta para alguno de los productos.', 1;

        DECLARE @Total DECIMAL(14,2);
        SELECT @Total = SUM(CONVERT(DECIMAL(14,2), i.cantidad * m.precio_venta))
          FROM @Items i JOIN dbo.Lote l ON l.lote_id = i.lote_id
          JOIN dbo.Medicamento m ON m.medicamento_id = l.medicamento_id;
        INSERT dbo.Venta(cliente_id, usuario_id, receta_id, tipo_comprobante,
                              numero_comprobante, total)
            VALUES (@ClienteId, @UsuarioId, @RecetaId, @TipoComprobante,
                    @NumeroComprobante, @Total);
        SET @VentaId = CONVERT(INT, SCOPE_IDENTITY());
        INSERT dbo.DetalleVenta(venta_id, lote_id, cantidad, precio_unitario)
            SELECT @VentaId, i.lote_id, i.cantidad, m.precio_venta
            FROM @Items i JOIN dbo.Lote l ON l.lote_id = i.lote_id
            JOIN dbo.Medicamento m ON m.medicamento_id = l.medicamento_id;
        UPDATE l SET stock_actual = l.stock_actual - i.cantidad
          FROM dbo.Lote l JOIN @Items i ON i.lote_id = l.lote_id;
        INSERT dbo.MovimientoStock(lote_id, usuario_id, venta_id, tipo, cantidad)
            SELECT lote_id, @UsuarioId, @VentaId, 'SALIDA_VENTA', cantidad FROM @Items;
        COMMIT;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK;
        THROW;
    END CATCH
END;
GO

CREATE OR ALTER PROCEDURE dbo.sp_AnularVenta
    @VentaId INT,
    @UsuarioId INT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    BEGIN TRY
        BEGIN TRAN;
        -- Serializa solicitudes simultaneas de anulacion de la misma venta.
        IF NOT EXISTS (SELECT 1 FROM dbo.Venta WITH (UPDLOCK, HOLDLOCK)
                       WHERE venta_id = @VentaId AND estado = 'CONFIRMADA')
            THROW 50021, 'La venta no existe o ya esta anulada.', 1;
        IF NOT EXISTS (SELECT 1 FROM dbo.Usuario WHERE usuario_id = @UsuarioId AND activo = 1)
            THROW 50022, 'Usuario no autorizado para anular.', 1;
        UPDATE l SET stock_actual = l.stock_actual + d.cantidad
            FROM dbo.Lote l JOIN dbo.DetalleVenta d ON d.lote_id = l.lote_id
            WHERE d.venta_id = @VentaId;
        INSERT dbo.MovimientoStock(lote_id, usuario_id, venta_id, tipo, cantidad)
            SELECT lote_id, @UsuarioId, @VentaId, 'REVERSO_VENTA', cantidad
            FROM dbo.DetalleVenta WHERE venta_id = @VentaId;
        UPDATE dbo.Venta SET estado = 'ANULADA' WHERE venta_id = @VentaId;
        COMMIT;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK;
        THROW;
    END CATCH
END;
GO

-- Vistas de consulta para panel y reportes.
CREATE OR ALTER VIEW dbo.vw_StockMedicamento
AS
SELECT m.medicamento_id, m.sku, m.nombre,
       SUM(CASE WHEN l.fecha_vencimiento >= CONVERT(DATE, SYSDATETIME())
                THEN l.stock_actual ELSE 0 END) AS stock_vendible,
       SUM(CASE WHEN l.fecha_vencimiento < CONVERT(DATE, SYSDATETIME())
                THEN l.stock_actual ELSE 0 END) AS stock_vencido
FROM dbo.Medicamento m LEFT JOIN dbo.Lote l ON l.medicamento_id = m.medicamento_id
GROUP BY m.medicamento_id, m.sku, m.nombre;
GO
CREATE OR ALTER VIEW dbo.vw_AlertasLote
AS
SELECT l.lote_id, m.sku, m.nombre, l.codigo_lote, l.fecha_vencimiento,
       l.stock_actual, l.stock_minimo,
       CASE WHEN l.fecha_vencimiento < CONVERT(DATE, SYSDATETIME()) THEN 'VENCIDO'
            WHEN l.fecha_vencimiento <= DATEADD(DAY,30,CONVERT(DATE,SYSDATETIME())) THEN 'POR_VENCER'
            WHEN l.stock_actual <= l.stock_minimo THEN 'STOCK_BAJO' END AS alerta
FROM dbo.Lote l JOIN dbo.Medicamento m ON m.medicamento_id = l.medicamento_id
WHERE l.stock_actual > 0 AND
      (l.fecha_vencimiento <= DATEADD(DAY,30,CONVERT(DATE,SYSDATETIME()))
       OR l.stock_actual <= l.stock_minimo);
GO
CREATE OR ALTER VIEW dbo.vw_VentasDiarias
AS
SELECT CONVERT(DATE, fecha) AS fecha_venta,
       COUNT(*) AS numero_ventas,
       SUM(total) AS importe_total
FROM dbo.Venta WHERE estado = 'CONFIRMADA'
GROUP BY CONVERT(DATE, fecha);
GO

-- Datos maestros ficticios, sin usuarios ni contrasenas de demostracion.
INSERT dbo.Rol(nombre, descripcion) VALUES
    (N'Administrador',N'Gestiona usuarios, reportes y configuracion'),
    (N'Cajero',N'Registra ventas y clientes'),
    (N'Almacenero',N'Recepciona compras y lotes'),
    (N'Quimico farmaceutico',N'Verifica recetas y supervisa medicamentos');
INSERT dbo.Categoria(nombre) VALUES
    (N'Analgesicos'),(N'Antialergicos'),(N'Cuidado personal');
INSERT dbo.Medicamento(categoria_id,sku,nombre,principio_activo,presentacion,precio_venta,requiere_receta)
VALUES
    (1,'MED-001',N'Paracetamol 500 mg',N'Paracetamol',N'Caja x 20 tabletas',8.50,0),
    (2,'MED-002',N'Cetirizina 10 mg',N'Cetirizina',N'Caja x 10 tabletas',12.90,0),
    (3,'MED-003',N'Alcohol en gel 250 ml',NULL,N'Frasco 250 ml',9.90,0);
GO

/* EJEMPLO DE PRUEBA (ejecutar solo cuando exista un usuario activo, cliente,
   proveedor y lote asociado con stock). El ejemplo muestra la llamada, no
   introduce credenciales debiles ni datos de produccion.
DECLARE @lineas dbo.TDetalleVenta, @nuevoId INT;
INSERT @lineas(lote_id,cantidad) VALUES (1,2);
EXEC dbo.sp_RegistrarVenta @ClienteId=1,@UsuarioId=1,@RecetaId=NULL,
    @TipoComprobante='BOLETA',@NumeroComprobante='B001-000001',
    @Items=@lineas,@VentaId=@nuevoId OUTPUT;
SELECT @nuevoId AS venta_id;
*/

/* LIMITACIONES DEL PROTOTIPO ACADEMICO:
  - No emitir comprobantes tributarios validos (sin integracion SUNAT).
  - No sustituye validacion profesional de autenticidad, dosis ni contenido
    de la receta; solo verifica su registro, vigencia y pertenencia al cliente.
  - Autorizar roles y contrasenas en backend real; los procedimientos
    validan usuario activo, NO sus permisos.
  - Evitar INSERT/UPDATE directos sobre stock/ventas desde la aplicacion:
    usar procedimientos con transacciones y permisos minimos.
  - No abarca dispensacion controlada, devoluciones sanitarias ni impuestos.
*/
