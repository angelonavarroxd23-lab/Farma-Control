/* FarmaControl | Cuenta de aplicacion con privilegios minimos (RECOMENDADO)
   El backend NO debe conectarse como sa ni como administrador. Ejecute este script
   despues de FarmaControl_Database.sql, indicando la contrasena por variable:

     sqlcmd -S localhost -E -i FarmaControl_UsuarioAplicacion.sql -v AppPassword="<contrasena-larga-y-unica>"

   La contrasena NO se guarda en este archivo. Requiere autenticacion mixta en SQL Server
   si el backend se conectara con usuario y contrasena SQL. */
USE master;
GO
IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name = N'farmacontrol_app')
    CREATE LOGIN farmacontrol_app WITH PASSWORD = N'$(AppPassword)', CHECK_POLICY = ON, DEFAULT_DATABASE = FarmaControlBD;
GO
USE FarmaControlBD;
GO
IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N'farmacontrol_app')
    CREATE USER farmacontrol_app FOR LOGIN farmacontrol_app WITH DEFAULT_SCHEMA = dbo;
GO
-- Lectura y escritura de catalogos y maestros.
GRANT SELECT ON SCHEMA::dbo TO farmacontrol_app;
GRANT INSERT, UPDATE ON dbo.Usuario     TO farmacontrol_app;
GRANT INSERT, UPDATE ON dbo.Cliente     TO farmacontrol_app;
GRANT INSERT, UPDATE ON dbo.Proveedor   TO farmacontrol_app;
GRANT INSERT, UPDATE, DELETE ON dbo.Categoria TO farmacontrol_app;
GRANT INSERT, UPDATE ON dbo.Medicamento TO farmacontrol_app;
GRANT INSERT, UPDATE ON dbo.Lote        TO farmacontrol_app;
GRANT INSERT, UPDATE ON dbo.Receta      TO farmacontrol_app;
GRANT INSERT         ON dbo.AuditoriaOperacion TO farmacontrol_app;
-- Las existencias solo cambian mediante los procedimientos transaccionales.
DENY UPDATE ON OBJECT::dbo.Lote(stock_actual) TO farmacontrol_app;
DENY INSERT, UPDATE, DELETE ON dbo.MovimientoStock TO farmacontrol_app;
DENY INSERT, UPDATE, DELETE ON dbo.Compra          TO farmacontrol_app;
DENY INSERT, UPDATE, DELETE ON dbo.DetalleCompra   TO farmacontrol_app;
DENY INSERT, UPDATE, DELETE ON dbo.Venta           TO farmacontrol_app;
DENY INSERT, UPDATE, DELETE ON dbo.DetalleVenta    TO farmacontrol_app;
DENY UPDATE, DELETE ON dbo.AuditoriaOperacion      TO farmacontrol_app;
GRANT EXECUTE ON dbo.sp_RegistrarCompra TO farmacontrol_app;
GRANT EXECUTE ON dbo.sp_RegistrarVenta  TO farmacontrol_app;
GRANT EXECUTE ON dbo.sp_AnularVenta     TO farmacontrol_app;
GRANT EXECUTE ON TYPE::dbo.TDetalleCompra TO farmacontrol_app;
GRANT EXECUTE ON TYPE::dbo.TDetalleVenta  TO farmacontrol_app;
GO
PRINT N'Usuario farmacontrol_app configurado.';
GO
