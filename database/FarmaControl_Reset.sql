/* FarmaControl | RESTABLECER ENTORNO DE PRUEBAS
   ATENCION: elimina por completo la base FarmaControlBD y todos sus datos.
   Usar solo en el entorno de desarrollo. Luego ejecute FarmaControl_Database.sql. */
USE master;
GO
IF DB_ID(N'FarmaControlBD') IS NOT NULL
BEGIN
    ALTER DATABASE FarmaControlBD SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
    DROP DATABASE FarmaControlBD;
END;
GO
PRINT N'FarmaControlBD eliminada.';
GO
