# MazeLab OS — Backlog
Ultima actualizacion: 2026-03-27

Leyenda de estado: `[x]` Hecho | `[ ]` Pendiente
Prioridad: P0 = Critico/Urgente | P1 = Sprint actual | P2 = Proximo sprint | P3 = Backlog | P4 = Ideas/Largo plazo

---

## Sprint S01 — 27 mar al 10 abr 2026

### Bugs (P0)
- [x] BUG: CXC dashboard no cuadra con modulo CXC — dashboard usaba calculo propio, ahora delega a FinanceModule.computeKPIs()
- [x] BUG: CXC pierde eventId al facturar — faltaba sourceId en payload de openFacturarModal()
- [x] BUG: Historial avisos cobranza/solicitud OC se borra al facturar — faltaba copiar avisos_factura, notas_cobranza, cobros al crear nueva CXC
- [x] BUG: Buscador de servicios no filtra en formulario de venta — selector CSS no detectaba items ocultos
- [x] BUG: Modal se cierra al hacer clic accidental afuera — proteccion global mousedown-inside en app.js

### Features (P1)
- [x] FEAT: Traspaso integrado en formulario de venta — seccion colapsable "Info del Traspaso" con 10 campos opcionales
- [x] FEAT: Autocomplete de clientes con datos de contacto — datalist nativo + auto-fill tel/email (ventas + cotizador)
- [x] FEAT: Boton "Mail facturacion" en CXC — genera email con datos factura, copiar/mailto, datos bancarios
- [x] FEAT: Dashboard ops activity feed — feed de actividad de operaciones (checklist, equipos, traspaso) ultimos 7 dias

---

## Backlog Priorizado

### P2 — Proximo sprint
- [ ] FEAT: Dashboard comercial mejorado — YoY chart, tracking por ejecutivo, comisiones
- [ ] FEAT: Cotizador modo screenshot — vista sin precios para operarios
- [ ] FEAT: CXC Kanban de cobranza — vista kanban para gestion de cobranza
- [ ] FEAT: Sistema de alertas in-app — badge + panel de alertas (sin contacto, diseno pendiente, equipos, etc.)

### P3 — Backlog
- [ ] FEAT: AI Chatbot con contexto de plataforma — chatbot que conoce los datos del OS para ayudar con redaccion, consultas, etc.
- [ ] FEAT: Voice input para chatbot — Realtime Voice API (OpenAI) para interaccion por voz
- [ ] FEAT: Alertas WhatsApp (Twilio) — notificaciones de alertas clave al equipo
- [ ] FEAT: Cotizador conversacional con IA — input texto/voz, Claude interpreta, pre-rellena formulario
- [ ] BUG: Kanban post-evento facturas historicas — verificar que aparezcan correctamente (requiere deploy)

### P4 — Ideas / Largo plazo
- [ ] FEAT: Portal de cliente — vista read-only donde el cliente ve estado del evento, timeline, fotos
- [ ] FEAT: Reportes automaticos semanales — email/WhatsApp con resumen: ventas, cobranza, eventos, alertas
- [ ] FEAT: Predictive pricing — probabilidad de cierre segun historial de cotizaciones
- [ ] FEAT: Integracion bancaria — leer cartolas/CSV para conciliar pagos automaticamente
- [ ] FEAT: PWA operaciones movil — app liviana para operarios en terreno (checklist, fotos, reportes)
- [ ] FEAT: CRM con pipeline — prospecto > cotizado > cerrado > perdido, historial por cliente
- [ ] FEAT: Google Calendar bidireccional — crear evento al confirmar venta, sync de cambios
- [ ] FEAT: Agentes IA con escritura — lectura de datos + acciones autonomas (bajo riesgo) + cola aprobacion (alto riesgo)
- [ ] FEAT: Bodega v3 Vision IA — analisis de danos por foto con Claude Vision
- [ ] FEAT: Ideas creativas IA — sugerencias estacionales, paquetes nuevos, analisis rentabilidad

---

## Deferred (requieren diseno)
- [ ] Eventos cancelados en kanban (3 escenarios: temprano / last-minute / parcial)
- [ ] Columna "Waiting on" en kanban (eventos bloqueados en terceros)
- [ ] Items de checklist estandar personalizables globalmente

---

## Deploy pendiente
- SQL pendiente: ver memory/replit-pending-sql.md
- Branch actual: feature/traspaso
- Acumular cambios antes de git pull (~$0.50/pull)

---

## Git Workflow
- `master` = produccion estable
- `feature/xxx` = branches por feature o sprint
- Prefijos de commit: `fix:`, `feat:`, `refactor:`, `chore:`
- Merge a master solo cuando sprint esta estable y testeado
