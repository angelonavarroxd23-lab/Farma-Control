import json, subprocess
T = json.load(open('tablas.json'))
FKSET = {n: {c for c, _ in t['fks']} for n, t in T.items()}
COL = {'Rol':'#E8F1FB','Usuario':'#E8F1FB','AuditoriaOperacion':'#E8F1FB','Cliente':'#E6F6EE','Proveedor':'#E6F6EE','Receta':'#E6F6EE',
       'Categoria':'#FFF4DC','Medicamento':'#FFF4DC','Lote':'#FFF4DC','MovimientoStock':'#FFF4DC',
       'Compra':'#FBE9E7','DetalleCompra':'#FBE9E7','Venta':'#FBE9E7','DetalleVenta':'#FBE9E7'}
def table(n, physical):
    t = T[n]; rows = []
    for cn, ct, nl in t['cols']:
        tag = 'PK' if cn in t['pk'] else ('FK' if cn in FKSET[n] else ('UQ' if cn in t['uq'] else ''))
        ct = 'DECIMAL(14,2) calculada' if ct == 'AS' else ct
        txt = f'{cn}' + (f' : {ct} {"" if nl=="NOT NULL" else "NULL"}' if physical else '')
        b = ' <B>' if tag == 'PK' else ' '
        rows.append(f'<TR><TD ALIGN="LEFT" WIDTH="30">{('<FONT POINT-SIZE="9" COLOR="#555555">'+tag+'</FONT>') if tag else ' '}</TD><TD ALIGN="LEFT">{"<B>" if tag=="PK" else ""}{txt}{"</B>" if tag=="PK" else ""}</TD></TR>')
    return f'<<TABLE BORDER="1" CELLBORDER="0" CELLSPACING="0" CELLPADDING="3" BGCOLOR="white"><TR><TD COLSPAN="2" BGCOLOR="{COL[n]}"><B>{n}</B></TD></TR>{"".join(rows)}</TABLE>>'
def build(name, physical):
    g = ['digraph G {','rankdir=LR; nodesep=0.35; ranksep=1.1; splines=true; bgcolor="white";','node [shape=plain, fontname="Helvetica", fontsize=10]; edge [fontname="Helvetica", fontsize=9, color="#444444", arrowhead=crow, arrowtail=tee, dir=both, arrowsize=0.8];']
    for n in T: g.append(f'{n} [label={table(n, physical)}];')
    for n, t in T.items():
        for c, ref in t['fks']: g.append(f'{ref} -> {n} [taillabel="1", headlabel="N", label="{c}", labelfontsize=8];')
    g.append('}'); open(name + '.dot', 'w').write('\n'.join(g))
    subprocess.run(['dot', '-Tpng', '-Gdpi=130', name + '.dot', '-o', f'../{name}.png'], check=True)
build('modelo_logico', False); build('modelo_fisico', True)
# conceptual
rel = [('Rol','Usuario','agrupa a','1','N'),('Usuario','Venta','registra','1','N'),('Usuario','Compra','recepciona','1','N'),('Usuario','Venta','anula','1','N'),('Usuario','AuditoriaOperacion','genera','1','N'),
 ('Cliente','Venta','realiza','1','N'),('Cliente','Receta','es titular de','1','N'),('Receta','Venta','respalda','1','N'),('Proveedor','Compra','abastece','1','N'),
 ('Categoria','Medicamento','clasifica','1','N'),('Medicamento','Lote','se divide en','1','N'),('Compra','DetalleCompra','contiene','1','N'),('Lote','DetalleCompra','ingresa por','1','N'),
 ('Venta','DetalleVenta','contiene','1','N'),('Lote','DetalleVenta','sale por','1','N'),('Lote','MovimientoStock','registra','1','N'),('Usuario','MovimientoStock','ejecuta','1','N'),
 ('Compra','MovimientoStock','origina entradas','1','N'),('Venta','MovimientoStock','origina salidas y reversos','1','N')]
g = ['graph G {','layout=neato; overlap=false; splines=true; sep="+18"; bgcolor="white";','node [shape=box, style="rounded,filled", fontname="Helvetica", fontsize=11, margin="0.18,0.1"]; edge [fontname="Helvetica", fontsize=9, color="#555555"];']
for n in T: g.append(f'{n} [fillcolor="{COL[n]}"];')
for a, b, v, ca, cb in rel: g.append(f'{a} -- {b} [label="{v}", taillabel="{ca}", headlabel="{cb}"];')
g.append('}'); open('modelo_conceptual.dot', 'w').write('\n'.join(g))
subprocess.run(['dot', '-Tpng', '-Gdpi=130', 'modelo_conceptual.dot', '-o', '../modelo_conceptual.png'], check=True)
