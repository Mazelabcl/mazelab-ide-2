# QA, Bugs & Features — Sprint Post-Deploy (2026-03-15)

## BUGS (arreglar ya)

### BUG-1: Cotizador — botón "Generar cotización" (gris) no hace nada
- El botón gris no funciona (sin error en consola)
- El morado "Crear cotización" sí funciona, pero solo aparece al escribir "crea la cotización"
- **Root cause**: El botón gris llama sendAIMessage() que puede no disparar correctamente
- **Prioridad**: ALTA

### BUG-2: Cotizador — cantidades/días se pierden al crear cotización
- Caso: "AIdentity por 7 días para Cencosud, descuento a 14M"
- El agente valoriza correcto en chat (~20M, descuento a 14M)
- Al pasar a formulario: items quedan con cantidad=1, total=3M en vez de 14M
- **Root cause**: JSON del agente no incluye dias/cantidad o applyAICotizacion no los procesa
- **Prioridad**: ALTA

### BUG-3: CXC — labels de vencimiento no calzan
- Caso: Ojos Negros id:826, detalle="+30" pero dashboard="+60"
- **Prioridad**: MEDIA

### BUG-4: Email de cobranza — markdown en datos bancarios
- Genera `**Titular:** Plug Latam` en vez de texto plano
- Debería ser texto plano para copiar/pegar en email o WhatsApp
- **Prioridad**: MEDIA

---

## MEJORAS COTIZADOR

### MEJ-1: Labels editables en formulario cotización
- Permitir editar el texto de cada item ("Servicio por 2 hrs" → "Valor por 7 días")

### MEJ-2: Agente adapte descripción al contexto
- Si digo "foto tipo caricatura para día de la madre" → descripción refleje eso
- Mejorar prompt para que adapte descripcion del bloque

### MEJ-3: Cálculo inteligente días/packs
- Si pido 7 días y hay pack "día completo" → usar pack × 7
- Si no hay pack → base + horas adicionales × 7

---

## FEATURES NUEVAS

### FEAT-1: CXC — Notas/seguimiento de cobranza (ALTA)
- Escribir en qué quedó cada gestión: "socio no está, próxima semana", "lleva 2 sin contestar"
- Cada nota con fecha + texto libre
- Recordatorios: "martes contactar", "fin de mes revisar"

### FEAT-2: CXC — Botón "Copiar info evento" (MEDIA)
- Un click → clipboard: Nombre evento, Nro Factura, Fecha, Servicios

### FEAT-3: CXC — Contexto/historial comunicaciones (ALTA)
- Pegar emails/respuestas del cliente
- IA de cobranza conoce historial previo y genera seguimiento coherente
- Relacionado con FEAT-1

### FEAT-4: CXP/Nóminas — Asignar pago a nómina manualmente (ALTA)
- Campo "nómina asignada" en cada CXP
- Casos: pagos adelantados, pagos no a 30 días

### FEAT-5: CXC — Diferenciar sin factura pre-evento vs post-evento (MEDIA)
- Pre-evento = normal, post-evento = requiere acción

### FEAT-6: CXP — Gastos generales por jornada (BAJA)
- Propuesta: asociar a 1 evento del grupo y listo

### FEAT-7: CXC — Vista Kanban de cobranza (ALTA, fase 2)
- Columnas: 1er aviso, 2do aviso, comprometido, escalado, pagado
- IA redacta en cada paso, medir patrones

---

## PRIORIZACIÓN

### Sprint 1 — Bugs + Cotizador
1. BUG-1: Fix botón "Generar cotización"
2. BUG-2: Fix cantidades/días en cotización
3. BUG-4: Fix markdown en datos bancarios
4. MEJ-1: Labels editables en cotización
5. MEJ-2: Prompt adapte descripciones
6. MEJ-3: Cálculo días/packs

### Sprint 2 — CXC Tracking
7. FEAT-1: Notas de seguimiento cobranza
8. FEAT-2: Botón copiar info evento
9. FEAT-3: Contexto/historial comunicaciones
10. BUG-3: Labels vencimiento CXC
11. FEAT-5: Sin factura pre/post evento

### Sprint 3 — Nóminas + Futuro
12. FEAT-4: Asignar CXP a nómina
13. FEAT-6: Gastos por jornada
14. FEAT-7: Kanban de cobranza
