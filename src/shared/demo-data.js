// Demo data loader — only runs if localStorage is empty.
// Provides synthetic data for local QA testing.
// 47 servicios importados desde tarifario.xlsx (2026-03-11)
(function () {
    function daysFromNow(n) {
        var d = new Date();
        d.setDate(d.getDate() + n);
        return d.toISOString().slice(0, 10);
    }

    function load() {
        var storage = window.Mazelab && window.Mazelab.Storage;
        if (!storage) return;

        var now = Date.now();
        var hasSales = storage.SalesService.getAll().length > 0;

        // Always seed services if empty (even if sales exist)
        var hasServices = false;
        try { hasServices = (storage.ServicesService || storage.ServiceService || { getAll: function(){ return []; } }).getAll().length > 0; } catch(e) {}
        if (!hasServices) {
            loadServices(storage, now);
            console.log('Demo data: 47 servicios cargados desde tarifario.');
        }

        // Only load sales/clients/equipment/cotizaciones if no sales exist
        if (hasSales) return;

        loadDemoData(storage, now);
    }

    function loadServices(storage, now) {
        var svc1 = {
            id: 'demo-svc-glambot',
            nombre: 'Glambot',
            name: 'Glambot',
            categoria: 'Cinéticas',
            descripcion: 'Brazo robótico equipado con un iPhone 13 y una app de video avanzada para capturar videos dinámicos y de alta calidad. Su movimiento proporciona un efecto visual impactante, destacando en eventos por su innovación y capacidad tecnológica.',
            precio_base: 1350000,
            activo: true,
            featured: true,
            tarifario: JSON.stringify({
                base: { label: 'Glambot 2 hrs - Viene con 2 movimientos pre establecidos y videos ilimitados con logo y música.', descripcion: '', unitario: 1350000 },
                adicionales: [
                    { label: 'Hora adicional', descripcion: '', unitario: 100000 },
                    { label: 'Pantalla de 43 pulgadas con atril', descripcion: 'Para mostrar los videos que se han grabado', unitario: 150000 },
                    { label: 'Print Station - por hora', descripcion: 'Impresión de fotos instantáneas con logo. Tamaño 10x15 cms', unitario: 65000 },
                    { label: 'Desarrollo movimiento personalizado', descripcion: 'Tu nos dices como quieres que se mueva el robot', unitario: 150000 },
                    { label: 'Edición de video avanzada', descripcion: 'Agrega transiciones, cámara lenta, rápida, boomerang, glitch y otros fliltros', unitario: 150000 },
                    { label: 'Fondos Estaticos', descripcion: '- Back de prensa o Chroma - Fondo plantas artificiales - Luces led programables', unitario: 300000 },
                    { label: 'Fondos Tech', descripcion: '- Pantalla LED 3x3 - Corner LED 3x3', unitario: 1000000 },
                    { label: 'Promotor(a) / con conocimiento operativo del servicio', descripcion: '', unitario: 100000 },
                    { label: 'Animador', descripcion: '', unitario: 200000 },
                    { label: 'Sets instagrameables - desde', descripcion: 'Diseñamos un espacio de 2x2 metros con elementos de arte', unitario: 950000 },
                    { label: 'Branding', descripcion: 'Agrega logo a la base del robot. Diseño de branding debe ser enviado por cliente.', unitario: 250000 }
                ],
                packs: [
                    { label: 'Dia completo (máximo 10 hrs). Incluye Pantalla de 43 pulgadas.', descripcion: '', unitario: 1850000 },
                    { label: '2 a 3 días completos con Pantalla (tope 10 horas por dia). Valor diario', descripcion: '', unitario: 1450000 },
                    { label: '4 o más días completos con Pantalla (tope 10 horas por dia). Valor diario', descripcion: '', unitario: 1250000 }
                ]
            })
        };

        var svc2 = {
            id: 'demo-svc-instaclip',
            nombre: 'InstaClip',
            name: 'InstaClip',
            categoria: 'Cinéticas',
            descripcion: 'Sistema de video portátil que crea contenido instantáneo para redes sociales en eventos masivos. Ofrece videos personalizados con presencia de marca, optimizados para Reels y Stories, fomentando el contenido generado por los usuarios.',
            precio_base: 730000,
            activo: true,
            featured: false,
            tarifario: JSON.stringify({
                base: { label: 'Instaclip 2 hrs - Videos ilimitados con logo y música.', descripcion: '', unitario: 730000 },
                adicionales: [
                    { label: 'Hora adicional', descripcion: '', unitario: 80000 },
                    { label: 'Pantalla de 43 pulgadas con atril', descripcion: 'Para mostrar los videos que se han grabado', unitario: 150000 },
                    { label: 'Edición de video avanzada', descripcion: 'Agrega transiciones, cámara lenta, rápida, boomerang, glitch y otros fliltros', unitario: 300000 },
                    { label: 'Fondos Estaticos', descripcion: '- Back de prensa o Chroma - Fondo plantas artificiales - Luces led programables', unitario: 300000 },
                    { label: 'Fondos Tech', descripcion: '- Pantalla LED 3x3 - Corner LED 3x3', unitario: 1000000 },
                    { label: 'Promotor(a) / con conocimiento operativo del servicio', descripcion: '', unitario: 100000 },
                    { label: 'Animador', descripcion: '', unitario: 200000 },
                    { label: 'Sets instagrameables - desde', descripcion: 'Diseñamos un espacio de 2x2 metros con elementos de arte', unitario: 950000 }
                ],
                packs: [
                    { label: 'Dia completo (máximo 10 hrs). Incluye Pantalla de 43 pulgadas.', descripcion: '', unitario: 1200000 },
                    { label: '2 a 3 días completos con Pantalla (tope 10 horas por dia). Valor diario', descripcion: '', unitario: 900000 },
                    { label: '4 o más días completos con Pantalla (tope 10 horas por dia). Valor diario', descripcion: '', unitario: 720000 }
                ]
            })
        };

        var svc3 = {
            id: 'demo-svc-ef',
            nombre: 'Studio Booth',
            name: 'Studio Booth',
            categoria: 'Foto',
            descripcion: 'Studio Pop Up con cámara reflex y software de marketing fotográfico, crea fotos, GIFs o videos que pueden ser totalmente personalizados para resaltar cualquier marca o situación en un evento.',
            precio_base: 610000,
            activo: true,
            featured: false,
            tarifario: JSON.stringify({
                base: { label: 'Studio Pop Up o Tótem 2 hrs. Toma fotos, gifs o videos', descripcion: '', unitario: 610000 },
                adicionales: [
                    { label: 'Hra adicional', descripcion: '', unitario: 100000 },
                    { label: 'Pantalla de 43 pulgadas con atril', descripcion: 'Para mostrar los videos que se han grabado', unitario: 150000 },
                    { label: 'Print Station - por hora', descripcion: 'Impresión de fotos instantáneas con logo. Tamaño 10x15 cms', unitario: 65000 },
                    { label: 'Fondos Estaticos', descripcion: '- Back de prensa o Chroma - Fondo plantas artificiales - Luces led programables', unitario: 300000 },
                    { label: 'Fondos Tech', descripcion: '- Pantalla LED 3x3 - Corner LED 3x3', unitario: 1000000 },
                    { label: 'Promotor(a) / con conocimiento operativo del servicio', descripcion: '', unitario: 100000 },
                    { label: 'Animador', descripcion: '', unitario: 200000 },
                    { label: 'Inteligencia Artificial', descripcion: 'Faceswap y otros filtros', unitario: 300000 },
                    { label: 'Sets instagrameables - desde', descripcion: 'Diseñamos un espacio de 2x2 metros con elementos de arte', unitario: 950000 },
                    { label: 'Branding', descripcion: 'Branding de las 4 caras de un plinto de 90x45x45 cms. En caso de no activar este item se cubre con una tela negra. Diseño de branding debe ser enviado por cliente.', unitario: 200000 }
                ],
                packs: [
                    { label: 'Dia completo (máximo 10 hrs). Incluye Pantalla de 43 pulgadas.', descripcion: '', unitario: 900000 },
                    { label: '2 a 3 días completos con Pantalla (tope 10 horas por dia). Valor diario', descripcion: '', unitario: 825000 },
                    { label: '4 o más días completos con Pantalla (tope 10 horas por dia). Valor diario', descripcion: '', unitario: 650000 }
                ]
            })
        };

        var svc4 = {
            id: 'demo-svc-lenticular',
            nombre: 'Studio Booth Lenticular',
            name: 'Studio Booth Lenticular',
            categoria: 'Foto',
            descripcion: 'Studio Pop Up con cámara reflex y software de marketing fotográfico. Crea fotos que pueden ser totalmente personalizados para resaltar cualquier marca o situación en un evento.',
            precio_base: 1200000,
            activo: true,
            featured: true,
            tarifario: JSON.stringify({
                base: { label: 'Studio Pop Up o Tótem 2 hrs.', descripcion: '', unitario: 1200000 },
                adicionales: [
                    { label: 'Hra adicional', descripcion: '', unitario: 100000 },
                    { label: 'Pantalla de 43 pulgadas con atril', descripcion: 'Para mostrar los videos que se han grabado', unitario: 150000 },
                    { label: 'Fondos Estaticos', descripcion: '- Back de prensa o Chroma - Fondo plantas artificiales - Luces led programables', unitario: 300000 },
                    { label: 'Fondos Tech', descripcion: '- Pantalla LED 3x3 - Corner LED 3x3', unitario: 1000000 },
                    { label: 'Promotor(a) / con conocimiento operativo del servicio', descripcion: '', unitario: 100000 },
                    { label: 'Animador', descripcion: '', unitario: 200000 },
                    { label: 'Inteligencia Artificial', descripcion: 'Faceswap y otros filtros', unitario: 300000 },
                    { label: 'Sets instagrameables - desde', descripcion: 'Diseñamos un espacio de 2x2 metros con elementos de arte', unitario: 950000 },
                    { label: 'Branding', descripcion: 'Branding de las 4 caras de un plinto de 90x45x45 cms. En caso de no activar este item se cubre con una tela negra. Diseño de branding debe ser enviado por cliente.', unitario: 200000 }
                ],
                packs: [
                    { label: 'Dia completo (máximo 10 hrs). Incluye Pantalla de 43 pulgadas.', descripcion: '', unitario: 1550000 },
                    { label: '2 a 3 días completos con Pantalla (tope 10 horas por dia). Valor diario', descripcion: '', unitario: 1350000 },
                    { label: '4 o más días completos con Pantalla (tope 10 horas por dia). Valor diario', descripcion: '', unitario: 1250000 }
                ]
            })
        };

        var svc5 = {
            id: 'demo-svc-minibox',
            nombre: 'MiniBox',
            name: 'MiniBox',
            categoria: 'Foto',
            descripcion: 'Minibox es una experiencia visual inmersiva y divertida, donde los invitados asoman su cabeza dentro de una caja que simula una galería de arte, museo o vitrina de productos completamente brandeada.\nUna foto o GIF donde la persona se ve gigante dentro del espacio, como si fuera parte de una obra o ',
            precio_base: 1150000,
            activo: true,
            featured: true,
            tarifario: JSON.stringify({
                base: { label: 'MiniBox + Studio Pop Up 4 hrs.', descripcion: '', unitario: 1150000 },
                adicionales: [
                    { label: 'Hra adicional', descripcion: '', unitario: 100000 },
                    { label: 'Pantalla de 43 pulgadas con atril', descripcion: 'Para mostrar los videos que se han grabado', unitario: 150000 },
                    { label: 'Print Station', descripcion: 'Impresión de fotos instantáneas con logo. Tamaño 10x15 cms', unitario: 65000 },
                    { label: 'Promotor(a) / con conocimiento operativo del servicio', descripcion: '', unitario: 100000 },
                    { label: 'Animador', descripcion: '', unitario: 200000 },
                    { label: 'Branding Minibox por dentro', descripcion: 'Branding de caras internas', unitario: 150000 },
                    { label: 'Branding Minibox por fuera', descripcion: 'Branding de caras externas.', unitario: 100000 }
                ],
                packs: [
                    { label: 'Dia completo (máximo 10 hrs). Incluye Pantalla de 43 pulgadas.', descripcion: '', unitario: 1550000 },
                    { label: '2 a 3 días completos con Pantalla (tope 10 horas por dia). Valor diario', descripcion: '', unitario: 1350000 },
                    { label: '4 o más días completos con Pantalla (tope 10 horas por dia). Valor diario', descripcion: '', unitario: 1250000 }
                ]
            })
        };

        var svc6 = {
            id: 'demo-svc-irisbooth',
            nombre: 'Iris Booth',
            name: 'Iris Booth',
            categoria: 'Foto',
            descripcion: 'Transformamos la mirada en una imagen.\nNuestro dispositivo captura el iris de cada persona con tecnología de alta precisión. En solo segundos, obtenemos una fotografía detallada y sorprendente del iris, que se convierte en un recuerdo exclusivo y altamente compartible.',
            precio_base: 1250000,
            activo: true,
            featured: true,
            tarifario: JSON.stringify({
                base: { label: 'IrisBooth 4 hrs.', descripcion: '', unitario: 1250000 },
                adicionales: [
                    { label: 'Hra adicional', descripcion: '', unitario: 100000 },
                    { label: 'Pantalla de 43 pulgadas con atril', descripcion: 'Para mostrar los videos que se han grabado', unitario: 150000 },
                    { label: 'Print Station', descripcion: 'Impresión de fotos instantáneas con logo. Tamaño 10x15 cms', unitario: 65000 },
                    { label: 'Promotor(a) / con conocimiento operativo del servicio', descripcion: '', unitario: 100000 },
                    { label: 'Animador', descripcion: '', unitario: 200000 },
                    { label: 'Branding', descripcion: 'Diseño de branding debe ser enviado por cliente', unitario: 200000 }
                ],
                packs: [
                    { label: 'Dia completo (máximo 10 hrs). Incluye Pantalla de 43 pulgadas.', descripcion: '', unitario: 1550000 },
                    { label: '2 a 3 días completos con Pantalla (tope 10 horas por dia). Valor diario', descripcion: '', unitario: 1350000 },
                    { label: '4 o más días completos con Pantalla (tope 10 horas por dia). Valor diario', descripcion: '', unitario: 1250000 }
                ]
            })
        };

        var svc7 = {
            id: 'demo-svc-illustratorbooth',
            nombre: 'Illustrator Booth',
            name: 'Illustrator Booth',
            categoria: 'Foto',
            descripcion: 'Capturamos una imágen cenital de la persona, luego la digitalizamos en una tablet donde un Ilustrador dibuja alrededor, elementos y formas relacionadas al concepto del evento.\nEsta nueva foto/imagen se entrega digital o impresa a la persona.',
            precio_base: 1450000,
            activo: true,
            featured: true,
            tarifario: JSON.stringify({
                base: { label: 'Illustrator Booth 4 hrs. Incluye Ilustrador y Studio Fotográfico', descripcion: '', unitario: 1450000 },
                adicionales: [
                    { label: 'Hra adicional', descripcion: '', unitario: 150000 },
                    { label: 'Pantalla de 43 pulgadas con atril', descripcion: 'Para mostrar los videos que se han grabado', unitario: 150000 },
                    { label: 'Print Station', descripcion: 'Impresión de fotos instantáneas con logo. Tamaño 10x15 cms', unitario: 65000 },
                    { label: 'Promotor(a) / con conocimiento operativo del servicio', descripcion: '', unitario: 100000 },
                    { label: 'Animador', descripcion: '', unitario: 200000 },
                    { label: 'Branding', descripcion: 'Diseño de branding debe ser enviado por cliente', unitario: 200000 }
                ],
                packs: [
                    { label: 'Dia completo (máximo 10 hrs). Incluye Pantalla de 43 pulgadas.', descripcion: '', unitario: 1650000 },
                    { label: '2 a 3 días completos con Pantalla (tope 10 horas por dia). Valor diario', descripcion: '', unitario: 1450000 },
                    { label: '4 o más días completos con Pantalla (tope 10 horas por dia). Valor diario', descripcion: '', unitario: 1250000 }
                ]
            })
        };

        var svc8 = {
            id: 'demo-svc-smart-mirror',
            nombre: 'Smart Mirror',
            name: 'Smart Mirror',
            categoria: 'Foto',
            descripcion: 'Studio Pop Up con cámara reflex y software de marketing fotográfico, crea fotos, GIFs o videos que pueden ser totalmente personalizados para resaltar cualquier marca o situación en un evento.',
            precio_base: 550000,
            activo: true,
            featured: false,
            tarifario: JSON.stringify({
                base: { label: 'Smart Mirror touch, 65 pulgadas. 2 hrs', descripcion: '', unitario: 550000 },
                adicionales: [
                    { label: 'Hra adicional', descripcion: '', unitario: 100000 },
                    { label: 'Pantalla de 43 pulgadas con atril', descripcion: 'Para mostrar los videos que se han grabado', unitario: 150000 },
                    { label: 'Print Station - por hora', descripcion: 'Impresión de fotos instantáneas con logo. Tamaño 10x15 cms', unitario: 65000 },
                    { label: 'Fondos Estaticos', descripcion: '- Back de prensa o Chroma - Fondo plantas artificiales - Luces led programables', unitario: 300000 },
                    { label: 'Fondos Tech', descripcion: '- Pantalla LED 3x3 - Corner LED 3x3', unitario: 1000000 },
                    { label: 'Promotor(a) / con conocimiento operativo del servicio', descripcion: '', unitario: 100000 },
                    { label: 'Animador', descripcion: '', unitario: 200000 },
                    { label: 'Inteligencia Artificial', descripcion: 'Faceswap y otros filtros', unitario: 300000 },
                    { label: 'Sets instagrameables - desde', descripcion: 'Diseñamos un espacio de 2x2 metros con elementos de arte', unitario: 950000 },
                    { label: 'Branding', descripcion: 'Branding de las 4 caras de un plinto de 90x45x45 cms. En caso de no activar este item se cubre con una tela negra. Diseño de branding debe ser enviado por cliente.', unitario: 200000 }
                ],
                packs: [
                    { label: 'Dia completo (máximo 10 hrs). Incluye Pantalla de 43 pulgadas.', descripcion: '', unitario: 900000 },
                    { label: '2 a 3 días completos con Pantalla (tope 10 horas por dia). Valor diario', descripcion: '', unitario: 825000 },
                    { label: '4 o más días completos con Pantalla (tope 10 horas por dia). Valor diario', descripcion: '', unitario: 650000 }
                ]
            })
        };

        var svc9 = {
            id: 'demo-svc-kaleido',
            nombre: 'Kaleido',
            name: 'Kaleido',
            categoria: 'Foto',
            descripcion: 'Corresponde a un kaleidoscopio hexagonal para tomarse fotos o videos',
            precio_base: 750000,
            activo: true,
            featured: false,
            tarifario: JSON.stringify({
                base: { label: 'Kaleidoscopio 2 hrs - fotos/videos ilimitados con logo y música.', descripcion: '', unitario: 750000 },
                adicionales: [
                    { label: 'Hora adicional', descripcion: '', unitario: 100000 },
                    { label: 'Print Station - por hora', descripcion: 'Impresión de fotos instantáneas con logo. Tamaño 10x15 cms', unitario: 65000 },
                    { label: 'Promotor(a) / con conocimiento operativo del servicio', descripcion: '', unitario: 100000 },
                    { label: 'Animador', descripcion: '', unitario: 200000 },
                    { label: 'Pantalla de 43 pulgadas con atril', descripcion: 'Para mostrar los videos que se han grabado', unitario: 150000 },
                    { label: 'Pantalla de 75 pulgadas con atril', descripcion: 'Ideal para llevar la experiencia a un siguiente nivel. El resultado del Kaleido queda mucho más llamativo si detrás de la persona se pone una TV que tenga contenido.', unitario: 450000 }
                ],
                packs: [
                    { label: 'Día completo con Pantalla (máximo 10 hrs).', descripcion: '', unitario: 1200000 },
                    { label: '2 a 3 días completos con Pantalla (tope 10 horas por dia). Valor diario', descripcion: '', unitario: 1050000 },
                    { label: '4 o más días completos con Pantalla (tope 10 horas por dia). Valor diario', descripcion: '', unitario: 950000 }
                ]
            })
        };

        var svc10 = {
            id: 'demo-svc-hashtag',
            nombre: 'Hashtag',
            name: 'Hashtag',
            categoria: 'Foto',
            descripcion: 'Automatiza la impresión de fotos publicadas en Instagram usando un hashtag del evento. Cada impresión incluye el logo de la marca, promoviendo la interacción en redes sociales de forma orgánica y proporcionando un recuerdo tangible.',
            precio_base: 680000,
            activo: true,
            featured: false,
            tarifario: JSON.stringify({
                base: { label: '"Estación de hashtag station 2 hrs. - fotos ilimitadas', descripcion: 'La persona debe compartir la foto como publicación, no como historia. Su perfil debe estar configurado como PUBLICO"', unitario: 680000 },
                adicionales: [
                    { label: 'Hra adicional', descripcion: '', unitario: 150000 },
                    { label: 'Pantalla de 43 pulgadas con atril', descripcion: 'Para mostrar los videos que se han grabado', unitario: 150000 },
                    { label: 'Promotor(a) / con conocimiento operativo del servicio', descripcion: '', unitario: 100000 },
                    { label: 'Animador', descripcion: '', unitario: 200000 },
                    { label: 'Branding', descripcion: 'Branding de las 4 caras de un plinto de 90x45x45 cms. En caso de no activar este item se cubre con una tela negra. Diseño de branding debe ser enviado por cliente.', unitario: 200000 }
                ],
                packs: [
                    { label: 'Dia completo (máximo 10 hrs). Incluye Pantalla de 43 pulgadas.', descripcion: '', unitario: 900000 },
                    { label: '2 a 3 días completos con Pantalla (tope 10 horas por dia). Valor diario', descripcion: '', unitario: 825000 },
                    { label: '4 o más días completos con Pantalla (tope 10 horas por dia). Valor diario', descripcion: '', unitario: 650000 }
                ]
            })
        };

        var svc11 = {
            id: 'demo-svc-mosaico',
            nombre: 'Mosaico',
            name: 'Mosaico',
            categoria: 'Foto',
            descripcion: 'Utiliza fotos tomadas en el evento para formar un mosaico que revela una imagen más grande, como un logo o una frase de la marca. Cada asistente contribuye al arte final, pegando su foto en un panel numerado.',
            precio_base: 950000,
            activo: true,
            featured: false,
            tarifario: JSON.stringify({
                base: { label: 'Estación de fotos.', descripcion: '', unitario: 950000 },
                adicionales: [
                    { label: 'Hra adicional', descripcion: '', unitario: 100000 },
                    { label: 'Copia de recuerdo para el invitado.', descripcion: 'Por defecto el mosaico imprime solo la foto que se pega en el panel. Si activas este ítem, llevaremos una segunda cámara e impresora para imprimirle una foto al asistente y que se pueda llevar de recuerdo.', unitario: 300000 },
                    { label: 'Pantalla de 43 pulgadas con atril', descripcion: 'Para mostrar la grilla digitalmente', unitario: 150000 },
                    { label: 'Fondos Estaticos', descripcion: '- Back de prensa o Chroma - Fondo plantas artificiales - Luces led programables', unitario: 300000 },
                    { label: 'Fondos Tech', descripcion: '- Pantalla LED 3x3 - Corner LED 3x3', unitario: 1000000 },
                    { label: 'Promotor(a) / con conocimiento operativo del servicio', descripcion: '', unitario: 100000 },
                    { label: 'Animador', descripcion: '', unitario: 200000 },
                    { label: 'Branding', descripcion: 'Branding de las 4 caras de un plinto de 90x45x45 cms. En caso de no activar este item se cubre con una tela negra. Diseño de branding debe ser enviado por cliente.', unitario: 200000 },
                    { label: 'Sets instagrameables - desde', descripcion: 'Diseñamos un espacio de 2x2 metros con elementos de arte', unitario: 950000 }
                ],
                packs: [
                    { label: 'Grilla numerada impresa en Fomex o Sintra (tamaño aprox: 2x2 mts). Se puede pegar con doble contacto al stand o montar sobre un atril de madera', descripcion: '(variante)', unitario: 300000 },
                    { label: 'Dia completo (máximo 10 hrs). Incluye Pantalla de 43 pulgadas.', descripcion: '', unitario: 1700000 },
                    { label: '2 a 3 días completos con Pantalla (tope 10 horas por dia). Valor diario', descripcion: '', unitario: 1450000 },
                    { label: '4 o más días completos con Pantalla (tope 10 horas por dia). Valor diario', descripcion: '', unitario: 1250000 }
                ]
            })
        };

        var svc12 = {
            id: 'demo-svc-multicam',
            nombre: 'Multicam',
            name: 'Multicam',
            categoria: 'Foto',
            descripcion: 'Captura acciones desde múltiples ángulos utilizando varias cámaras simultáneamente. Crea videos o GIFs que muestran a la persona congelada en el tiempo, con resultados listos para compartir al instante.',
            precio_base: 600000,
            activo: true,
            featured: false,
            tarifario: JSON.stringify({
                base: { label: 'Multicam 3 cámaras 2 hrs.', descripcion: '', unitario: 600000 },
                adicionales: [
                    { label: 'Hora adicional Multicam', descripcion: '', unitario: 150000 },
                    { label: 'Pantalla de 43 pulgadas con atril', descripcion: 'Para mostrar los videos que se han grabado', unitario: 150000 },
                    { label: 'Print Station - por hora', descripcion: 'Impresión de fotos instantáneas con logo. Tamaño 10x15 cms', unitario: 50000 },
                    { label: 'Fondos Estaticos', descripcion: '- Back de prensa o Chroma - Fondo plantas artificiales - Luces led programables', unitario: 300000 },
                    { label: 'Fondos Tech', descripcion: '- Pantalla LED 4x3 - Corner LED 4x3', unitario: 1500000 },
                    { label: 'Promotor(a) / con conocimiento operativo del servicio', descripcion: '', unitario: 100000 },
                    { label: 'Animador', descripcion: '', unitario: 200000 },
                    { label: 'Branding', descripcion: 'Branding de las 4 caras de un plinto de 90x45x45 cms. En caso de no activar este item se cubre con una tela negra. Diseño de branding debe ser enviado por cliente.', unitario: 200000 }
                ],
                packs: [
                    { label: 'Multicam 6 cámaras 2 hrs.', descripcion: '(variante)', unitario: 700000 },
                    { label: 'Multicam 9 cámaras 2 hrs.', descripcion: '(variante)', unitario: 900000 },
                    { label: 'Multicam 12 cámaras 2 hrs.', descripcion: '(variante)', unitario: 1100000 },
                    { label: 'Montaje y desmontaje', descripcion: '(variante)', unitario: 350000 },
                    { label: 'Dia completo Multicam 12 camaras (máximo 10 hrs). Incluye Pantalla de 43 pulgadas.', descripcion: '', unitario: 1850000 },
                    { label: '2 a 3 días completos Multicam 12 camaras con Pantalla (tope 10 horas por dia). Valor diario', descripcion: '', unitario: 1450000 },
                    { label: '4 o más días completos Multicam 12 camaras con Pantalla (tope 10 horas por dia). Valor diario', descripcion: '', unitario: 1250000 }
                ]
            })
        };

        var svc13 = {
            id: 'demo-svc-lookbook',
            nombre: 'Lookbook',
            name: 'Lookbook',
            categoria: 'Foto',
            descripcion: 'Un despliegue espectacular de tecnología y diseño. Doce cámaras, luces intermitentes y un diseño en media luna que no solo captura la atención visual, sino que también crea GIFs dinámicos y estilizados que todos desearán compartir.',
            precio_base: 1850000,
            activo: true,
            featured: true,
            tarifario: JSON.stringify({
                base: { label: 'Lookbook 2 hrs.', descripcion: '', unitario: 1850000 },
                adicionales: [
                    { label: 'Hora adicional LookBook', descripcion: '', unitario: 150000 },
                    { label: 'Pantalla de 43 pulgadas con atril - Jornada completa', descripcion: 'Para mostrar los videos que se han grabado', unitario: 150000 },
                    { label: 'Print Station - por hora', descripcion: 'Impresión de fotos instantáneas con logo. Tamaño 10x15 cms', unitario: 50000 },
                    { label: 'Fondos Estaticos', descripcion: '- Back de prensa o Chroma - Fondo plantas artificiales - Luces led programables', unitario: 300000 },
                    { label: 'Fondos Tech', descripcion: '- Pantalla LED 3x3 - Corner LED 3x3', unitario: 1000000 },
                    { label: 'Promotor(a) / con conocimiento operativo del servicio', descripcion: '', unitario: 100000 },
                    { label: 'Animador', descripcion: '', unitario: 200000 },
                    { label: 'Branding', descripcion: 'Branding de las 4 caras de un plinto de 90x45x45 cms. En caso de no activar este item se cubre con una tela negra. Diseño de branding debe ser enviado por cliente.', unitario: 200000 }
                ],
                packs: [
                    { label: 'Dia completo LookBook 12 camaras (máximo 10 hrs). Incluye Pantalla de 43 pulgadas.', descripcion: '', unitario: 1850000 },
                    { label: '2 a 3 días completos LookBook 12 camaras con Pantalla (tope 10 horas por dia). Valor diario', descripcion: '', unitario: 1450000 },
                    { label: '4 o más días completos LookBook 12 camaras con Pantalla (tope 10 horas por dia). Valor diario', descripcion: '', unitario: 1250000 }
                ]
            })
        };

        var svc14 = {
            id: 'demo-svc-faceswap',
            nombre: 'FaceSwap',
            name: 'FaceSwap',
            categoria: 'IA',
            descripcion: 'Combina la tecnología de nuestro Studio con software de IA para crear intercambios de rostros personalizados que los asistentes pueden compartir en sus redes sociales, aumentando la visibilidad de la marca de manera divertida y viral.',
            precio_base: 950000,
            activo: true,
            featured: false,
            tarifario: JSON.stringify({
                base: { label: 'Studio Pop Up con Pantalla 43" o Tótem 2 hrs.', descripcion: '', unitario: 950000 },
                adicionales: [
                    { label: 'Hra adicional', descripcion: '', unitario: 100000 },
                    { label: 'Print Station - por hora', descripcion: 'Impresión de fotos instantáneas con logo. Tamaño 10x15 cms', unitario: 65000 },
                    { label: 'Sets instagrameables - desde', descripcion: 'Diseñamos un espacio de 2x2 metros con elementos de arte', unitario: 950000 },
                    { label: 'Promotor(a) / con conocimiento operativo del servicio', descripcion: '', unitario: 100000 },
                    { label: 'Animador', descripcion: '', unitario: 200000 },
                    { label: 'Branding', descripcion: 'Branding de las 4 caras de un plinto de 90x45x45 cms. En caso de no activar este item se cubre con una tela negra. Diseño de branding debe ser enviado por cliente.', unitario: 200000 }
                ],
                packs: [
                    { label: 'Dia completo (máximo 10 hrs). Incluye Pantalla de 43 pulgadas.', descripcion: '', unitario: 1400000 },
                    { label: '2 a 3 días completos con Pantalla (tope 10 horas por dia). Valor diario', descripcion: '', unitario: 1250000 },
                    { label: '4 o más días completos con Pantalla (tope 10 horas por dia). Valor diario', descripcion: '', unitario: 950000 }
                ]
            })
        };

        var svc15 = {
            id: 'demo-svc-action-figure',
            nombre: 'Action Figure',
            name: 'Action Figure',
            categoria: 'IA',
            descripcion: '',
            precio_base: 950000,
            activo: true,
            featured: false,
            tarifario: JSON.stringify({
                base: { label: 'Sistema Instaclip para tomar la foto (Aro de luz portátil + iPhone + Nuestra App IA)', descripcion: 'El operador toma la foto, la IA la procesa en aprox 30 segundos y se comparte por QR al instante.  Se puede poner sobre un trípode con un foco de iluminación.  Filtro IA - Action Figure:  La foto se la persona se transforma en una Figura Coleccionable y se inserta en un diseño de caja con íconos de la marca y logo. Se podrán tener 3 variaciones de caja con distintos accesorios.  Referente: https://drive.google.com/file/d/1DI0_G4q8233jjvhmb4bGOE3BWvtmCYFQ/view?usp=sharing', unitario: 950000 },
                adicionales: [
                    { label: 'Print Station -  4 horas', descripcion: 'Impresión de fotos instantáneas con logo. Tamaño 10x15 cms', unitario: 200000 },
                    { label: 'Promotor(a) / con conocimiento operativo del servicio', descripcion: '', unitario: 100000 },
                    { label: 'Animador', descripcion: '', unitario: 200000 }
                ],
                packs: [
                    { label: 'Foto Fotográfico touch de 43 pulgadas con App IA', descripcion: 'El operador toma la foto, la IA la procesa en aprox 30 segundos y se comparte por QR al instante.  Filtro IA - Action Figure:  La foto se la persona se transforma en una Figura Coleccionable y se inserta en un diseño de caja con íconos de la marca y logo. Se podrán tener 3 variaciones de caja con distintos accesorios.  Referente: https://drive.google.com/file/d/1tVxK2eUmtHn7J-iPExuDQfdrj0hOaCWl/view?usp=sharing', unitario: 1250000 }
                ]
            })
        };

        var svc16 = {
            id: 'demo-svc-aidentity',
            nombre: 'AIdentity',
            name: 'AIdentity',
            categoria: 'IA',
            descripcion: '',
            precio_base: 1250000,
            activo: true,
            featured: true,
            tarifario: JSON.stringify({
                base: { label: 'Studio Pop Up o Tótem. Toma fotos de una persona y las procesa con IA.', descripcion: 'Servicio por 4 horas', unitario: 1250000 },
                adicionales: [
                    { label: 'Print Station -  4 horas', descripcion: 'Impresión de fotos instantáneas con logo. Tamaño 10x15 cms', unitario: 200000 },
                    { label: 'Promotor(a) / con conocimiento operativo del servicio', descripcion: '', unitario: 100000 },
                    { label: 'Animador', descripcion: '', unitario: 200000 }
                ],
                packs: []
            })
        };

        var svc17 = {
            id: 'demo-svc-colorme-booth',
            nombre: 'ColorMe Booth',
            name: 'ColorMe Booth',
            categoria: 'IA',
            descripcion: '',
            precio_base: 1500000,
            activo: true,
            featured: true,
            tarifario: JSON.stringify({
                base: { label: 'Studio Fotográfico. Toma fotos de una o varias personas y las procesa con IA', descripcion: '', unitario: 1500000 },
                adicionales: [
                    { label: 'Promotor(a) / con conocimiento operativo del servicio', descripcion: '', unitario: 100000 },
                    { label: 'Animador', descripcion: '', unitario: 200000 }
                ],
                packs: []
            })
        };

        var svc18 = {
            id: 'demo-svc-arteconia',
            nombre: 'Arte con IA',
            name: 'Arte con IA',
            categoria: 'IA',
            descripcion: 'Transforma verbalizaciones de los asistentes en arte visual mediante IA. Durante el evento, estas imágenes se recopilan para formar un fotomosaico que representa visualmente la marca o un mensaje específico.',
            precio_base: 1150000,
            activo: true,
            featured: true,
            tarifario: JSON.stringify({
                base: { label: 'Sistema Arte con IA - 4 horas', descripcion: 'Incluye Tótem touch de 43 pulgadas, softwares IA y scripts. Incluye Prompt Engineering para que las imagenes creadas tengan relación con el evento. Mosaico que forma el logo de la marca con las imagenes creadas por los asistentes.  El mosaico se entrega 30 minutos después de finalizada la actividad. Se entrega en formato JPG y se envía al correo por WeTransfer.', unitario: 1150000 },
                adicionales: [
                    { label: 'Tótem Touch, día completo (10 hrs) EXTRA', descripcion: '', unitario: 450000 },
                    { label: 'Estudio Chroma', descripcion: 'Primero la persona pasa por el tótem para generar su fondo con IA. Luego, la persona se toma una foto frente a nuestra cámara reflex a un costado del tótem y se genera un montaje de la persona sobre el fondo creado con IA).', unitario: 350000 },
                    { label: 'Promotor(a) / con conocimiento operativo del servicio', descripcion: '', unitario: 100000 },
                    { label: 'Animador', descripcion: '', unitario: 200000 },
                    { label: 'Print Station - por hora', descripcion: 'Impresión de fotos instantáneas con logo. Tamaño 10x15 cms', unitario: 65000 }
                ],
                packs: []
            })
        };

        var svc19 = {
            id: 'demo-svc-genai-wall',
            nombre: 'GenAI Wall',
            name: 'GenAI Wall',
            categoria: 'IA',
            descripcion: 'Este sistema se compone de una cámara que captura los movimientos de la persona y lo transforma en tiempo real aplicandole una capa de estilo con Inteligencia Artificial Generativa.',
            precio_base: 1950000,
            activo: true,
            featured: true,
            tarifario: JSON.stringify({
                base: { label: 'Sistema Instant Art con IA - 4 horas', descripcion: 'Incluye Tótem touch de 55 pulgadas, softwares IA y scripts. Incluye cámara para capturar a la persona. Incluye Prompt Engineering para que las imagenes creadas tengan relación con el evento. Se genera una imagen en tiempo real en la pantalla la cual cambia según el comportamiento de la persona.  * Se puede reemplazar el tótem por conexión directa a la pantalla LED que tengan en el Stand/Evento. En este caso el visualista debe entregarnos un cable HDMI que conecte directo nuestro computador a su mesa de trabajo', unitario: 1950000 },
                adicionales: [
                    { label: 'Instant Art, día completo (10 hrs) EXTRA', descripcion: '', unitario: 950000 },
                    { label: 'Promotor(a) / con conocimiento operativo del servicio', descripcion: '', unitario: 100000 },
                    { label: 'Animador', descripcion: '', unitario: 200000 }
                ],
                packs: []
            })
        };

        var svc20 = {
            id: 'demo-svc-videobooth',
            nombre: 'AI Video',
            name: 'AI Video',
            categoria: 'IA',
            descripcion: 'Los invitados se toman una foto en nuestro Tótem Interactivo, la cual es procesada por un modelo de IA previamente entrenado y adaptado al concepto de tu evento. Utilizando Generative AI Image y una descripción detallada de la escena, crearemos la imagen con la que inicia el video y una imagen con l',
            precio_base: 1950000,
            activo: true,
            featured: true,
            tarifario: JSON.stringify({
                base: { label: 'Sistema Instant Art con IA - 4 horas', descripcion: 'Incluye Tótem touch de 55 pulgadas, softwares IA y scripts. Incluye cámara para capturar a la persona. Incluye Prompt Engineering para que las imagenes creadas tengan relación con el evento. Utilizando Generative AI Image, crearemos la imagen con la que inicia el video y una imagen con la que termina. Utilizando Generative AI Video y una descripción detallada de la escena, le pediremos a la IA que interprete el movimiento de inicio a fin.  Duración: 10 segundos Formato: mp4 Tamaño: 9:16   El proceso en total toma aproximadamente de 3 a 5 minutos. Por lo que les llega posterior a sus correos.  * Se puede reemplazar el tótem por conexión directa a la pantalla LED que tengan en el Stand/Evento. En este caso el visualista debe entregarnos un cable HDMI que conecte directo nuestro computador a su mesa de trabajo', unitario: 1950000 },
                adicionales: [
                    { label: 'Promotor(a) / con conocimiento operativo del servicio', descripcion: '', unitario: 100000 },
                    { label: 'Animador', descripcion: '', unitario: 200000 }
                ],
                packs: [
                    { label: '2 a 3 días completos (tope 10 horas por dia). Valor diario', descripcion: '', unitario: 1800000 },
                    { label: '4 o más días completos (tope 10 horas por dia). Valor diario', descripcion: '', unitario: 1650000 }
                ]
            })
        };

        var svc21 = {
            id: 'demo-svc-aimusic',
            nombre: 'AI Music',
            name: 'AI Music',
            categoria: 'IA',
            descripcion: 'Transforma verbalizaciones de los asistentes en Canciones mediante IA.',
            precio_base: 1350000,
            activo: true,
            featured: true,
            tarifario: JSON.stringify({
                base: { label: 'Sistema Música con IA', descripcion: 'Incluye Tótem touch de 43 pulgadas, softwares IA y scripts. Incluye Prompt Engineering para que las canciones creadas tengan relación con el evento.  Las canción demora aprox 1 minuto en procesarse y se envía en formato Audio por WhatsApp o con QR.  Incluye internet (según disponibilidad de red 3g/4g)', unitario: 1350000 },
                adicionales: [
                    { label: 'Entrega en formato Video', descripcion: 'Se genera un video con el logo de la marca y la letra tipo Karaoke. El resultado se demora aprox 3-5 minutos en procesar y se envia por correo o código QR.', unitario: 250000 },
                    { label: 'Impresión de QR en formato Foto', descripcion: 'Mediante una cámara le tomaremos una foto a la persona la cual se entregará impresa al insante con branding del evento. En la foto aparecerá un código QR el cual al ser escaneado, lleva a la persona directamente a su Canción (mp3 o mp4)', unitario: 200000 },
                    { label: 'Promotor(a) / con conocimiento operativo del servicio', descripcion: '', unitario: 100000 },
                    { label: 'Animador', descripcion: '', unitario: 200000 }
                ],
                packs: [
                    { label: '2 a 3 días completos (tope 10 horas por dia). Valor diario', descripcion: '', unitario: 1080000 },
                    { label: '4 o más días completos (tope 10 horas por dia). Valor diario', descripcion: '', unitario: 945000 }
                ]
            })
        };

        var svc22 = {
            id: 'demo-svc-avatarconia',
            nombre: 'Avatar con IA',
            name: 'Avatar con IA',
            categoria: 'IA',
            descripcion: 'Personaliza avatares digitales con un objetivo y personalidad alineados a la marca. Responde interactivamente a preguntas usando IA, perfecto para atender, informar o vender productos o servicios en eventos.',
            precio_base: 1800000,
            activo: true,
            featured: true,
            tarifario: JSON.stringify({
                base: { label: 'Sistema Avatar con Inteligencia artificial', descripcion: 'Corresponde a una interfaz en tótem touch donde la persona podrá realizar preguntas por audio (micrófono) y el avatar le responderá casi en tiempo real mediante IA. -Incluye Prompt Engineering, pruebas y configuraciones. -Incluye agregar base de conocimiento básica (máximo 2 páginas de Word). -Incluye uso Avatares Estándar', unitario: 1800000 },
                adicionales: [
                    { label: 'Avatar Personalizado', descripcion: 'Diseñamos la cara del avatar que hablará con los usuarios.', unitario: 100000 },
                    { label: 'Upgrade a Tótem touch de 55 pulgadas dual pantalla', descripcion: '', unitario: 450000 },
                    { label: 'Promotor(a) / con conocimiento operativo del servicio', descripcion: '', unitario: 100000 },
                    { label: 'Animador', descripcion: '', unitario: 200000 }
                ],
                packs: [
                    { label: 'Dia completo (máximo 10 hrs).', descripcion: '', unitario: 2750000 },
                    { label: '2 a 3 días completos (tope 10 horas por dia). Valor diario.', descripcion: '', unitario: 1950000 },
                    { label: '4 o más días completos (tope 10 horas por dia). Valor diario.', descripcion: '', unitario: 1650000 }
                ]
            })
        };

        var svc23 = {
            id: 'demo-svc-avatar-pregrabado',
            nombre: 'Avatar Pre Grabado',
            name: 'Avatar Pre Grabado',
            categoria: 'IA',
            descripcion: 'Este sistema permite animar una foto o una ilustración.\nNos deben enviar el texto y nosotros entregamos un video con fondo personalizable (puede ser chroma) de la cara hablando el mensaje.',
            precio_base: 280000,
            activo: true,
            featured: false,
            tarifario: JSON.stringify({
                base: { label: 'Avatar hablante', descripcion: 'Incluye configurar la cara de un humano (gerente, colaborador, etc). Incluye crear un avatar usando IA que represente a la marca.  Incluye hasta 5 minutos hablados. Incluye casting de voces con IA (te enviaremos 5 propuestas de voz de hombre y mujer para que elijas la que más representa a tu marca). Se puede usar tambien audio enviado por el cliente  * No se pueden usar rostros famosos ya que el programa los rechaza por riesgos de Deepfake.', unitario: 280000 },
                adicionales: [],
                packs: [
                    { label: 'Pack 5 minutos adicionales', descripcion: '(variante)', unitario: 120000 },
                    { label: 'Sistema para que el Avatar salude a los asistentes al ingresar', descripcion: 'Esto considera un operador con un botón a distancia. Para lograr el efecto, creamos 5 loops de videos con distintos saludos + 1 video en "reposo".  Cuando una persona pase frente al avatar, nuestro operador activará el saludo. Los asistentes pensarán que el avatar los vio pasar y los saludó.  En caso de conectarnos a un proveedor de pantallas LED, se debe coordinar para poder switchear al avatar con teclado inalambrico.', unitario: 400000 },
                    { label: 'Tótem 55 pulgadas dual pantalla (opcional)', descripcion: '(variante)', unitario: 300000 }
                ]
            })
        };

        var svc24 = {
            id: 'demo-svc-instatattoo',
            nombre: 'InstaTattoo',
            name: 'InstaTattoo',
            categoria: 'Foto',
            descripcion: 'Ofrece tatuajes temporales con diseños que pueden personalizarse con la marca. Utiliza una impresora especial para aplicar los tatuajes directamente en la piel, proporcionando una forma interactiva y memorable de engagement en eventos.',
            precio_base: 700000,
            activo: true,
            featured: false,
            tarifario: JSON.stringify({
                base: { label: 'Impresora de tatuajes', descripcion: '', unitario: 700000 },
                adicionales: [
                    { label: '500 tatuajes adicionales', descripcion: '', unitario: 250000 },
                    { label: 'Tatuaje a Color', descripcion: '', unitario: 300000 },
                    { label: 'Pack 5 tatuajes personalizados', descripcion: 'Logo de la marca, frase, etc', unitario: 100000 },
                    { label: 'Crear tatuajes con IA', descripcion: 'La persona describe su tatuaje ideal y nosotros lo creamos con IA y lo configuramos en la impresora. Esto demora 2 minutos aproxl', unitario: 350000 },
                    { label: 'Promotor(a) / con conocimiento operativo del servicio', descripcion: '', unitario: 100000 },
                    { label: 'Animador', descripcion: '', unitario: 200000 }
                ],
                packs: [
                    { label: '2 a 3 días completos (Hasta 500 tatuajes por día). Valor diario', descripcion: '', unitario: 625000 },
                    { label: '4 o más completos (Hasta 500 tatuajes por día). Valor diario', descripcion: '', unitario: 550000 }
                ]
            })
        };

        var svc25 = {
            id: 'demo-svc-facebot',
            nombre: 'FaceBot',
            name: 'FaceBot',
            categoria: 'IA',
            descripcion: 'Esta activación consta de un tablet con el cual se le toma una fotografía a la cara de una persona. Nuestra App fotográfica con IA automáticamente convertirá la foto en una caricatura y se la enviará al próximo Brazo Robot que esté desocupado. Cuando el brazo robot recibe la señal, comienza a dibuja',
            precio_base: 1200000,
            activo: true,
            featured: true,
            tarifario: JSON.stringify({
                base: { label: '1 Brazo robot (incluye 1 operador)', descripcion: '', unitario: 1200000 },
                adicionales: [
                    { label: 'Tomar fotos usando Studio fotográfico o Tótem touch 43 pulgadas', descripcion: '', unitario: 500000 },
                    { label: 'Promotor(a) / con conocimiento operativo del servicio', descripcion: '', unitario: 100000 },
                    { label: 'Animador', descripcion: '', unitario: 200000 },
                    { label: 'Branding', descripcion: 'Branding de los papeles donde el robot dibuja. Se brandea con el logo del cliente y se cortan con guillotina en tamaño 10x15 cms Valor considera 100 papeles', unitario: 150000 }
                ],
                packs: [
                    { label: '2 Brazos robots (incluye 1 operador)', descripcion: '(variante)', unitario: 1450000 }
                ]
            })
        };

        var svc26 = {
            id: 'demo-svc-messagebooth',
            nombre: 'MessageBooth',
            name: 'MessageBooth',
            categoria: 'Experiencias',
            descripcion: 'Los invitados pueden escribir mensajes personalizados directamente sobre una pantalla transparente.\nCada interacción es grabada desde dentro del dispositivo, generando un video o foto que inmortaliza su mensaje en una experiencia emocional, creativa y tecnológica.',
            precio_base: 1250000,
            activo: true,
            featured: true,
            tarifario: JSON.stringify({
                base: { label: 'MessageBooth, día completo (10 hrs)', descripcion: '', unitario: 1250000 },
                adicionales: [
                    { label: 'Hora adicional', descripcion: '', unitario: 100000 },
                    { label: 'Print Station - por hora', descripcion: 'Impresión de fotos instantáneas con logo. Tamaño 10x15 cms', unitario: 65000 },
                    { label: 'Promotor(a) / con conocimiento operativo del servicio', descripcion: '', unitario: 100000 },
                    { label: 'Animador', descripcion: '', unitario: 200000 },
                    { label: 'Branding', descripcion: 'Branding de las caras de la caja. En caso de no activar este item, el MessageBooth es de color negro. Diseño de branding debe ser enviado por cliente.', unitario: 250000 }
                ],
                packs: [
                    { label: '2 a 3 días completos (tope 10 horas por dia). Valor diario', descripcion: '', unitario: 1050000 },
                    { label: '4 o más días completos (tope 10 horas por dia). Valor diario', descripcion: '', unitario: 850000 }
                ]
            })
        };

        var svc27 = {
            id: 'demo-svc-holobox',
            nombre: 'Holobox',
            name: 'Holobox',
            categoria: 'Display',
            descripcion: 'Presenta una caja holográfica que crea avatares instantáneos en tiempo real, considerada la activación más innovadora del 2024. Combina efectos visuales con interactividad para captar la atención de manera espectacular.',
            precio_base: 1150000,
            activo: true,
            featured: true,
            tarifario: JSON.stringify({
                base: { label: 'Holograma Holobox 65 pulgadas, día completo (10 hrs)', descripcion: '', unitario: 1150000 },
                adicionales: [
                    { label: 'Sistema Instant Avatar:', descripcion: 'La persona se para frente a una cámara (WebCam) y frente a un fondo blanco. Dentro del Holobox aparecerá el cuerpo de la persona junto con su cara en versión caricatura', unitario: 350000 },
                    { label: 'Sistema Portada de Revista', descripcion: 'La persona se para frente a una cámara (iPhone 13) y frente a un fondo blanco. Dentro del Holobox aparecerá el cuerpo de la persona como si fuera con un diseño como si fuera la portada de una revista.', unitario: 350000 },
                    { label: 'Sistema Avatar Pre grabado', descripcion: 'Creamos un avatar digital o humano pre grabado el cual tiene mensajes pre definidos como por ejemplo, saludos de bienvenida a los invitados que vienen llegando al evento.  Nuestro operador tiene un control a distancia y activa al avatar cuando una persona pasa por el frente, para crear la sensación de que el avatar vio a la persona y lo saludó. Se consideran 5 saludos pre grabados.  *No incluye locación para grabar al humano.', unitario: 450000 },
                    { label: 'Filtro personalizado Marca', descripcion: '', unitario: 450000 },
                    { label: 'Tracking personalizado a cuerpo (desde)', descripcion: '', unitario: 850000 },
                    { label: 'Sistema Avatar En Vivo', descripcion: 'Montamos un fondo blanco y un Studio Streaming para transmitir a un animador directo al Holobox. La idea es crear un streaming entre la cámara del Holobox y el animador con fondo blanco para crear un holograma en tiempo real y poder conversar.', unitario: 750000 },
                    { label: 'Print Station - por hora', descripcion: 'Impresión de fotos instantáneas con logo. Tamaño 10x15 cms', unitario: 65000 },
                    { label: 'Otros desarrollos Touch (desde)', descripcion: '', unitario: 850000 },
                    { label: 'Promotor(a) / con conocimiento operativo del servicio', descripcion: '', unitario: 100000 },
                    { label: 'Animador', descripcion: '', unitario: 200000 },
                    { label: 'Branding', descripcion: 'Branding de las caras del Holobox. En caso de no activar este item, el Holobox es de color Blanco.  Diseño de branding debe ser enviado por cliente.', unitario: 200000 }
                ],
                packs: [
                    { label: '2 a 3 días completos (tope 10 horas por dia). Con Sistema Instant Avatar. Valor diario', descripcion: '', unitario: 1400000 },
                    { label: '4 o más días completos (tope 10 horas por dia). Valor diario', descripcion: '', unitario: 1250000 }
                ]
            })
        };

        var svc28 = {
            id: 'demo-svc-holotube',
            nombre: 'HoloTube',
            name: 'HoloTube',
            categoria: 'Display',
            descripcion: 'Presenta una caja holográfica que crea avatares instantáneos en tiempo real, considerada la activación más innovadora del 2024. Combina efectos visuales con interactividad para captar la atención de manera espectacular.',
            precio_base: 950000,
            activo: true,
            featured: false,
            tarifario: JSON.stringify({
                base: { label: 'Holograma Holotube 24 pulgadas, día completo (10 hrs)', descripcion: '', unitario: 950000 },
                adicionales: [
                    { label: 'Sistema Instant Avatar:', descripcion: 'La persona se para frente a una cámara (iPhone 13) y frente a un fondo negro. Dentro del Holotube aparecerá el cuerpo de la persona junto con su cara en versión caricatura', unitario: 350000 },
                    { label: 'Video Holográfico simple', descripcion: 'Se cotiza por proyecto, pero por ejemplo un video en formato holograma con logo del cliente y objetos en 3d que ya estén modelados. Desde 550.000 + IVA', unitario: 550000 },
                    { label: 'Videos Holográficos de mayor complejidad', descripcion: '', unitario: 1200000 },
                    { label: 'Kiosk Touch', descripcion: 'Corresponde a una pantalla touch donde la persona podrá cambiar el contenido dentro del HoloTube. Por ejemplo podría usarse para ver distintas características de un producto.', unitario: 350000 },
                    { label: 'Promotor(a) / con conocimiento operativo del servicio', descripcion: '', unitario: 100000 },
                    { label: 'Animador', descripcion: '', unitario: 200000 },
                    { label: 'Otros desarrollos Touch (desde)', descripcion: '', unitario: 850000 }
                ],
                packs: [
                    { label: 'Holograma Holotube 32 pulgadas, día completo (10 hrs)', descripcion: '(variante)', unitario: 1650000 },
                    { label: 'Holograma Holotube 85 pulgadas, día completo (10 hrs)', descripcion: '(variante)', unitario: 2350000 },
                    { label: '2 a 3 días completos (tope 10 horas por dia). Con Sistema Instant Avatar. Valor diario', descripcion: '', unitario: 1700000 },
                    { label: '4 o más días completos (tope 10 horas por dia). Valor diario', descripcion: '', unitario: 1550000 }
                ]
            })
        };

        var svc29 = {
            id: 'demo-svc-holograma',
            nombre: 'Holograma',
            name: 'Holograma',
            categoria: 'Display',
            descripcion: 'Tenemos varios tipos de hologramas que te ayudarán a sorprender en tu siguiente evento o activación.\nEn los precios se considera el arriendo día completo del holograma.',
            precio_base: 320000,
            activo: true,
            featured: false,
            tarifario: JSON.stringify({
                base: { label: 'Holograma 1 Hélice - Cupula de acrílico - 42 cms', descripcion: '', unitario: 320000 },
                adicionales: [],
                packs: [
                    { label: 'Holograma 1 Hélice - Cupula de acrílico - 52 cms', descripcion: '(variante)', unitario: 360000 },
                    { label: 'Holograma 1 Hélice - Cupula de acrílico - 65 cms', descripcion: '(variante)', unitario: 440000 },
                    { label: 'Holograma 1 Hélice - Cupula de acrílico - 75 cms', descripcion: '(variante)', unitario: 740000 },
                    { label: 'Holograma 1 Hélice - Cupula de acrílico - 100 cms', descripcion: '(variante)', unitario: 960000 },
                    { label: 'Holograma 4 Hélices - Cupula de acrílico - 42 cms', descripcion: '(variante)', unitario: 1350000 },
                    { label: 'Holograma 18 Hélices - Cupula de acrílico - 42 cms', descripcion: '(variante)', unitario: 2800000 },
                    { label: 'Holograma OLED 55 pulgadas - Reflexión', descripcion: '(variante)', unitario: 950000 },
                    { label: 'Holograma Piramidal', descripcion: '(variante)', unitario: 950000 },
                    { label: 'Holobox 50 pulgadas', descripcion: '(variante)', unitario: 750000 },
                    { label: 'Holobox 65 pulgadas', descripcion: '(variante)', unitario: 1050000 },
                    { label: 'Holobox 80 pulgadas', descripcion: '(variante)', unitario: 1400000 },
                    { label: 'Holotube 21 pulgadas', descripcion: '(variante)', unitario: 750000 },
                    { label: 'Holotube 32 pulgadas', descripcion: '(variante)', unitario: 1350000 },
                    { label: 'Sensor movimiento para interacción', descripcion: '(variante)', unitario: 300000 },
                    { label: 'Holograma cortina de humo + (Laser o Proyector)', descripcion: 'Incluye líquido para generar humo por 2 horas.', unitario: 2750000 },
                    { label: 'Contenido', descripcion: 'Crear un video holográfico mezclando imagenes estáticas del cliente (logos) con modelos 3d prediseñados (planetas, figuras, etc). Valor desde', unitario: 350000 }
                ]
            })
        };

        var svc30 = {
            id: 'demo-svc-ti',
            nombre: 'Tótem Interactivo',
            name: 'Tótem Interactivo',
            categoria: 'Interactivos',
            descripcion: 'Dispone de una pantalla táctil de 43 pulgadas para interactuar con juegos personalizados como ruletas, trivias y advergames, todos diseñados para reflejar la marca y mejorar la experiencia del usuario.',
            precio_base: 550000,
            activo: true,
            featured: false,
            tarifario: JSON.stringify({
                base: { label: 'Tótem Touch Interactivo 43 pulgadas, día completo (10 hrs)', descripcion: '', unitario: 550000 },
                adicionales: [
                    { label: 'Desarrollo juegos', descripcion: 'Ruleta, Memorice, Trivia, Falling Game, Rosco', unitario: 550000 },
                    { label: 'Formulario para capturar BBDD', descripcion: '', unitario: 150000 },
                    { label: 'Control de premios', descripcion: 'Pantalla de administrador donde puedes agregar o quitar premios para tener mayor control sobre la entregada durante el evento', unitario: 150000 },
                    { label: 'Body Tracking', descripcion: 'Cámara Kinect para controlar el juego con el movimiento del cuerpo', unitario: 250000 },
                    { label: 'Upgrade Tótem', descripcion: 'Tótem 55 pulgadas Dual Pantalla', unitario: 250000 },
                    { label: 'Promotor(a) / con conocimiento operativo del servicio', descripcion: '', unitario: 100000 },
                    { label: 'Animador', descripcion: '', unitario: 200000 },
                    { label: 'Branding', descripcion: 'Branding de las caras del Tótem. En caso de no activar este item, el tótem es de color Negro.  Diseño de branding debe ser enviado por cliente.', unitario: 250000 }
                ],
                packs: [
                    { label: '2 a 3 días completos (tope 10 horas por dia).', descripcion: '', unitario: 500000 },
                    { label: '4 o más días completos (tope 10 horas por dia). Valor diario', descripcion: '', unitario: 450000 }
                ]
            })
        };

        var svc31 = {
            id: 'demo-svc-botonera',
            nombre: 'Botonera',
            name: 'Botonera',
            categoria: 'Interactivos',
            descripcion: 'Dispone de una pantalla táctil de 43 pulgadas para interactuar con juegos personalizados como ruletas, trivias y advergames, todos diseñados para reflejar la marca y mejorar la experiencia del usuario.',
            precio_base: 1400000,
            activo: true,
            featured: true,
            tarifario: JSON.stringify({
                base: { label: 'Tótem Touch Interactivo 43 pulgadas, día completo (10 hrs)', descripcion: '', unitario: 1400000 },
                adicionales: [
                    { label: 'Formulario para capturar BBDD', descripcion: '', unitario: 150000 },
                    { label: 'Control de premios', descripcion: 'Pantalla de administrador donde puedes agregar o quitar premios para tener mayor control sobre la entregada durante el evento', unitario: 150000 },
                    { label: 'Upgrade Tótem', descripcion: 'Tótem 55 pulgadas Dual Pantalla', unitario: 250000 },
                    { label: 'Promotor(a) / con conocimiento operativo del servicio', descripcion: '', unitario: 100000 },
                    { label: 'Animador', descripcion: '', unitario: 200000 },
                    { label: 'Branding', descripcion: 'Branding de las caras del Tótem. En caso de no activar este item, el tótem es de color Negro.  Diseño de branding debe ser enviado por cliente.', unitario: 200000 }
                ],
                packs: [
                    { label: '2 a 3 días completos (tope 10 horas por dia).', descripcion: '', unitario: 800000 },
                    { label: '4 o más días completos (tope 10 horas por dia). Valor diario', descripcion: '', unitario: 750000 }
                ]
            })
        };

        var svc32 = {
            id: 'demo-svc-led-play-wall',
            nombre: 'LED Play Wall',
            name: 'LED Play Wall',
            categoria: 'Interactivos',
            descripcion: '',
            precio_base: 2450000,
            activo: true,
            featured: true,
            tarifario: JSON.stringify({
                base: { label: 'LED Play Wall:', descripcion: 'Chutear o lanzar pelota en pantalla grande touch  Incluye desarrollo y branding del juego con colores de la marca.', unitario: 2450000 },
                adicionales: [
                    { label: 'Arco para Pantalla', descripcion: '', unitario: 390000 },
                    { label: 'Pantalla LED con sistema touch 2x2', descripcion: '', unitario: 950000 },
                    { label: 'Pantalla LED con sistema touch 3x2', descripcion: '', unitario: 1100000 }
                ],
                packs: []
            })
        };

        var svc33 = {
            id: 'demo-svc-bike-game',
            nombre: 'Bike Game',
            name: 'Bike Game',
            categoria: 'Interactivos',
            descripcion: '',
            precio_base: 750000,
            activo: true,
            featured: false,
            tarifario: JSON.stringify({
                base: { label: 'Bicicleta estática con sensores', descripcion: '', unitario: 750000 },
                adicionales: [
                    { label: 'Desarrollo juegos', descripcion: '', unitario: 750000 },
                    { label: 'Formulario para capturar BBDD en Totem o Tablet', descripcion: '', unitario: 150000 },
                    { label: 'Control de premios', descripcion: 'Pantalla de administrador donde puedes agregar o quitar premios para tener mayor control sobre la entregada durante el evento', unitario: 150000 },
                    { label: 'Promotor(a) / con conocimiento operativo del servicio', descripcion: '', unitario: 100000 },
                    { label: 'Animador', descripcion: '', unitario: 200000 }
                ],
                packs: [
                    { label: '2 a 3 días completos (tope 10 horas por dia). Valor diario', descripcion: '', unitario: 1350000 },
                    { label: '4 o más días completos (tope 10 horas por dia). Valor diario', descripcion: '', unitario: 1250000 }
                ]
            })
        };

        var svc34 = {
            id: 'demo-svc-interactive-wall',
            nombre: 'Muro Interactivo',
            name: 'Muro Interactivo',
            categoria: 'Interactivos',
            descripcion: 'Consta de una estructura con sensores.\nAl apretar uno de los botones se muestra un video en la pantalla',
            precio_base: 2700000,
            activo: true,
            featured: true,
            tarifario: JSON.stringify({
                base: { label: 'Estructura autosoportante de 3x2 mts', descripcion: 'Hasta 8 sensores/botones para interactuar  Botones + TV 75 + Desarrollo  La estructura se compone de un 3x2 que viene con una pantalla de 75 pulgadas y botones o sensores.  Sobre esta estructura se pega un fomex p sintra el cual tiene un troquelado sobre la pantalla (por ejemplo troquel con la forma de una botella) (Referente: https://drive.google.com/file/d/1582RBwphL4zc5gv36gjwi1eukDtMQTUQ/view?usp=drive_link)  Este valor incluye personalizar el corte.', unitario: 2700000 },
                adicionales: [
                    { label: 'Promotor(a) / con conocimiento operativo del servicio', descripcion: '', unitario: 100000 },
                    { label: 'Animador', descripcion: '', unitario: 200000 }
                ],
                packs: []
            })
        };

        var svc35 = {
            id: 'demo-svc-message-wall',
            nombre: 'Message Wall',
            name: 'Message Wall',
            categoria: 'Interactivos',
            descripcion: 'Consta de una pantalla que proyecta los mensajes escritos en físico.',
            precio_base: 1950000,
            activo: true,
            featured: true,
            tarifario: JSON.stringify({
                base: { label: 'Scanner o Cámara', descripcion: 'Computador i7, 8gb RAM Desarrollo  Dinámica: Las personas escriben un mensaje o hacen un dibujo en un papel de 10x15 cms. una vez finalizado, le entregan el papel a nuestro operador quien utilizando un scanner o cámara lo escaneará y aparecerá en la pantalla junto a los otros mensajes enviados crenado una experiencia colaborativa donde se puedan realizar brainstormings, felicitaciones, etc.', unitario: 1950000 },
                adicionales: [],
                packs: [
                    { label: 'Back personalizado', descripcion: '(variante)', unitario: 950000 },
                    { label: 'TV 43 pulgadas', descripcion: '(variante)', unitario: 150000 },
                    { label: 'TV 75 pulgadas', descripcion: '(variante)', unitario: 450000 },
                    { label: 'Promotor(a) / con conocimiento operativo del servicio', descripcion: '(variante)', unitario: 100000 },
                    { label: 'Animador', descripcion: '(variante)', unitario: 200000 }
                ]
            })
        };

        var svc36 = {
            id: 'demo-svc-signature-wall',
            nombre: 'Signature Wall',
            name: 'Signature Wall',
            categoria: 'Interactivos',
            descripcion: 'Muro de firmas donde el usuario firma/dibuja/escribe en un tótem touch y su trazo aparece instantáneamente en una pantalla grande. Puede ser un muro “libre” con todas las firmas o una versión donde las firmas se posicionan para formar el logo del cliente o imagen del concepto. Es participación colec',
            precio_base: 3200000,
            activo: true,
            featured: true,
            tarifario: JSON.stringify({
                base: { label: 'Totem Interactivo Touch', descripcion: 'Computador i7, 8gb RAM Desarrollo  Dinámica: Las personas se paran frente al Totem donde firma/dibuja/escribe y su trazo aparece instantáneamente en una pantalla grande. Puede ser un muro “libre” con todas las firmas o una versión donde las firmas se posicionan para formar el logo del cliente o imagen del concepto.', unitario: 3200000 },
                adicionales: [],
                packs: [
                    { label: 'Pantalla LED 2x2', descripcion: '(variante)', unitario: 650000 },
                    { label: 'Promotor(a) / con conocimiento operativo del servicio', descripcion: '(variante)', unitario: 100000 },
                    { label: 'Animador', descripcion: '(variante)', unitario: 200000 }
                ]
            })
        };

        var svc37 = {
            id: 'demo-svc-vr',
            nombre: 'VR',
            name: 'VR',
            categoria: 'Inmersivas',
            descripcion: 'Arriendo de lentes VR y desarrollo de apps y experiencias personalizadas.',
            precio_base: 400000,
            activo: true,
            featured: false,
            tarifario: JSON.stringify({
                base: { label: 'Arriendo Lente de RV Oculus Quest 2, día completo (10 hrs)', descripcion: 'Incluye cualquier experiencia que se pueda descargar desde Oculus Store o Video 360° público.', unitario: 400000 },
                adicionales: [
                    { label: 'Pantalla de 43 pulgadas con atril y computador - Jornada completa', descripcion: 'Para mostrar en vivo lo que se está viendo en los lentes', unitario: 200000 },
                    { label: 'Plataforma para Caminar en VR', descripcion: 'Corresponde a una caminadora donde la persona puede desplazarse en un mundo virtual.', unitario: 650000 },
                    { label: 'Promotor(a) / con conocimiento operativo del servicio', descripcion: '', unitario: 100000 },
                    { label: 'Animador', descripcion: '', unitario: 200000 },
                    { label: 'Juego tipo Beat Saber', descripcion: 'La persona debe golpear las notas musicales al ritmo de una canción mediante espadas laser. Se personaliza el entorno 3d con presencia de marca.  Cliente debe enviar el arte. Ojo con usar canciones que tengan derecho de autor, lo recomendable cuando no se tiene permiso es usar canciones sin.', unitario: 1500000 },
                    { label: 'Montaña Rusa', descripcion: 'Cambio de logo y colores corporativos', unitario: 1150000 },
                    { label: 'Sala Cine', descripcion: '', unitario: 890000 },
                    { label: 'Ataja Penales', descripcion: 'Cambio de logo y colores corporativos', unitario: 1350000 },
                    { label: 'Grabar video con cámara 360° y crear App VR', descripcion: 'Desde:', unitario: 1750000 }
                ],
                packs: []
            })
        };

        var svc38 = {
            id: 'demo-svc-ar',
            nombre: 'AR',
            name: 'AR',
            categoria: 'Inmersivas',
            descripcion: 'Desarrolla experiencias interactivas en la realidad aumentada, desde juegos hasta visualizaciones de productos, que integran lo digital con el entorno real para crear interacciones memorables y atractivas.',
            precio_base: null,
            activo: true,
            featured: false,
        };

        var svc39 = {
            id: 'demo-svc-p360',
            nombre: 'Plataforma 360',
            name: 'Plataforma 360',
            categoria: 'Cinéticas',
            descripcion: 'Esta activación ofrece una experiencia de video 360° con efectos especiales. Ocupa 2x2 m y necesita electricidad. Es una forma espectacular de destacar en cualquier tipo de evento con un enfoque visual.',
            precio_base: 660000,
            activo: true,
            featured: false,
            tarifario: JSON.stringify({
                base: { label: 'Plataforma 360 4 hrs - Incluye software de video avanzado', descripcion: '', unitario: 660000 },
                adicionales: [
                    { label: 'Hora adicional', descripcion: '', unitario: 80000 },
                    { label: 'Pantalla de 43 pulgadas con atril - Jornada completa', descripcion: 'Para mostrar los videos que se han grabado', unitario: 150000 },
                    { label: 'Print Station - por hora', descripcion: 'Impresión de fotos instantáneas con logo. Tamaño 10x15 cms', unitario: 65000 },
                    { label: 'Inteligencia Artificial', descripcion: 'Faceswap y otros filtros', unitario: 300000 },
                    { label: 'Branding base', descripcion: '', unitario: 90000 }
                ],
                packs: []
            })
        };

        var svc40 = {
            id: 'demo-svc-gravity',
            nombre: 'Gravity',
            name: 'Gravity',
            categoria: 'Cinéticas',
            descripcion: 'Consta de una estructura con 8 electroimanes en los cuales se pueden colgar productos de la marca.\nUn operador dará la señal para que los electroimanes vayan botando los productos 1 a 1.\nEste juego se trata de agliidad, la persona deberá intentar agarrar los productos sin que toque el suelo',
            precio_base: 1150000,
            activo: true,
            featured: true,
            tarifario: JSON.stringify({
                base: { label: 'Tótem Gravity', descripcion: '', unitario: 1150000 },
                adicionales: [
                    { label: 'Promotor(a) / con conocimiento operativo del servicio', descripcion: '', unitario: 100000 },
                    { label: 'Animador', descripcion: '', unitario: 200000 },
                    { label: '8 * Varillas con color corporativo', descripcion: '', unitario: 150000 },
                    { label: 'Branding estructura', descripcion: 'Referente: https://drive.google.com/file/d/1Rx82Yfql4e3pw0axFTkVnR3BEWdKiuwr/view?usp=drive_link', unitario: 150000 }
                ],
                packs: []
            })
        };

        var svc41 = {
            id: 'demo-svc-octagono',
            nombre: 'Octagono',
            name: 'Octagono',
            categoria: 'Cinéticas',
            descripcion: 'Consta de una estructura con 8 lados con sensores.\nLa dinámcia es que se para al medio del octágono un jugador con una pelota. A la cuenta de trés y durante un tiempo determinado se iran prendiendo las luces de los sensores. El objetivo del jugador es darle un pase usando la pelota y apagar la mayo',
            precio_base: 950000,
            activo: true,
            featured: false,
            tarifario: JSON.stringify({
                base: { label: 'Octágono futbol con sensores', descripcion: '', unitario: 950000 },
                adicionales: [
                    { label: 'Promotor(a) / con conocimiento operativo del servicio', descripcion: '', unitario: 100000 },
                    { label: 'Animador', descripcion: '', unitario: 200000 },
                    { label: 'Branding completo.', descripcion: 'En caso de no brandear, el color de la estructura es negro', unitario: 550000 },
                    { label: 'Totem touch con Ranking', descripcion: 'Se desarrollara un sistema tipo ranking donde la persona antes de ingresar al octagono se registra (al finalizar el evento se envian los datos recopilados al cliente). Cuando la persona termina de jugar, nuestro operador ingresa el puntaje obtenido. De esta manera obtendremos un ranking que se muestra en pantalla con los mejores puntajes.', unitario: 550000 }
                ],
                packs: []
            })
        };

        var svc42 = {
            id: 'demo-svc-muroreact',
            nombre: 'MuroReact',
            name: 'MuroReact',
            categoria: 'Interactivos',
            descripcion: 'Consta de una estructura con 8 sensores.\nLa dinámcia es que la persona se para frente a la estructura, a la cuenta de trés y durante un tiempo determinado se iran prendiendo las luces de los sensores. El objetivo del jugador es tocar y apagar la mayor cantidad de sensores posibles durante el tiempo',
            precio_base: 850000,
            activo: true,
            featured: false,
            tarifario: JSON.stringify({
                base: { label: 'Corresponde 6 botones/sensores que se pegan a algún muro o estructura del stand con doble contacto (no la incluye, la debe proveer el cliente).', descripcion: '- Estos sensores se conectan a una APP donde se puede ver el puntaje final. - Estos sensores permiten crear juegos donde compitan 2 personas ya que se prenden de distintos colores. - Existen multiples tipos de juegos y dinámicas  Además, incluye una pantalla touch con atril (o empotrada en el stand), donde el jugador se inscribe previamente para mostrar los mejores puntajes de la jornada.  Referente: https://drive.google.com/file/d/1eyJtnYYR3ASQH2-nrFWkDlNNvvr8JEsn/view?usp=sharing', unitario: 850000 },
                adicionales: [
                    { label: 'Promotor(a) / con conocimiento operativo del servicio', descripcion: '', unitario: 100000 },
                    { label: 'Animador', descripcion: '', unitario: 200000 },
                    { label: 'Branding completo.', descripcion: 'En caso de no brandear, el color de la estructura es negro', unitario: 350000 }
                ],
                packs: [
                    { label: 'Lo mismo que el punto anterior pero además incluye una estructura de fierro autosoportante donde se instalan los botones/sensores', descripcion: 'Referente: https://drive.google.com/file/d/1In6QHbs3v3LooMitStrmzXeSpUVZC5a7/view?usp=sharing', unitario: 1250000 },
                    { label: 'Corresponde a un muro de 2x2 con branding del cliente.', descripcion: 'En este muro ya vienen empotrados los 6 botones/sensores y la TV touch.  A diferencia de la version LIGHT que solo tiene un ranking, en este se puede personalizar una interfaz más completa que tiene: - Menu de inicio - Cuenta regresiva - Puntaje en pantalla el tiempo real - Puntaje final  Referente: https://drive.google.com/file/d/1IItGW06-F4uVfN476eG3TPVlOH9cu9-z/view?usp=sharing', unitario: 1650000 }
                ]
            })
        };

        var svc43 = {
            id: 'demo-svc-simulador-auto',
            nombre: 'Simulador Auto',
            name: 'Simulador Auto',
            categoria: 'Inmersivas',
            descripcion: '',
            precio_base: 850000,
            activo: true,
            featured: false,
            tarifario: JSON.stringify({
                base: { label: 'Incluye simulador completo de carreras.', descripcion: '- Butaca - Volante y pedales - Computador - Juego Racing  Montaje, desmontaje, operador jornada completa  (considerar 1 hora para almorzar).', unitario: 850000 },
                adicionales: [
                    { label: 'Simulador de carreras en Realidad Virtual.', descripcion: '', unitario: 250000 },
                    { label: 'Promotor(a) / con conocimiento operativo del servicio', descripcion: '', unitario: 100000 },
                    { label: 'Animador', descripcion: '', unitario: 200000 }
                ],
                packs: []
            })
        };

        var svc44 = {
            id: 'demo-svc-eventos-virtuales',
            nombre: 'Eventos Virtuales',
            name: 'Eventos Virtuales',
            categoria: 'Virtuales',
            descripcion: 'Desde streaming básico hasta plataformas virtuales completas con áreas como lobbies y auditorios virtuales, diseñados para reflejar la identidad de la marca y mejorar la participación del público.',
            precio_base: 450000,
            activo: true,
            featured: false,
            tarifario: JSON.stringify({
                base: { label: 'Evento Virtual - Solo Streaming', descripcion: 'Webinar simple donde juntamos a los panelistas en un zoom privado, capturamos cada cámara y creamos un streaming brandeado con transiciones, escenas, gc, etc. La emisión es mediante Zoom o Youtube Live. Valores desde por día', unitario: 450000 },
                adicionales: [],
                packs: [
                    { label: 'Evento Virtual - Streaming + Desarrollo Landing Page Privado', descripcion: 'Desarrollamos un mini sitio con login donde los asistentes deben registrarse antes de ingresar a la transmisión. Se personaliza con colores de la marca y logo. Incluye preguntas en vivo. Valores desde por día', unitario: 1250000 },
                    { label: 'Evento Virtual - Streaming + Plataforma Pro de Eventos Virtuales', descripcion: 'Para eventos que requieran varias salas en simultáneo, sesiones de networking, stands y soporte. Valores desde por día.', unitario: 1750000 }
                ]
            })
        };

        var svc45 = {
            id: 'demo-svc-capacitacion-gpt',
            nombre: 'Capacitación IA',
            name: 'Capacitación IA',
            categoria: 'Capacitación',
            descripcion: 'Mentoría online para grupos de trabajo donde revisamos distintas plataformas de IA que mejoran la productividad para trabajo individual o en equipo.',
            precio_base: 590000,
            activo: true,
            featured: false,
            tarifario: JSON.stringify({
                base: { label: 'Capacitación ChatGPT / IA Generativa', descripcion: 'Sesión online de 90 minutos donde revisaremos en detalle el funcionamiento de la plataforma ChatGPT junto con los mejores tips de como usarla para sacarle provecho.. Se realizará una breve introducción a la IA y las posibilidades que ofrece para mejorar la productividad. Se hará un recorrido detallado por todas las funcionalidades que ofrece ChatGPT para que le puedan sacar el mayor provecho. Se les enseñará distintas técnicas de Prompt Engineering ("como saber hablarle a la IA para obtener mejores respuestas"). Se les mostrarán otras plataformas que usan IA y una introducción a Vibe Coding para abrir la mente y que empiecen a pensar en posibles usos en su día a día.   En esta capacitación no solo se abordará ChatGPT, también creación de imagenes, videos y plataforma de Agentes.   Al finalizar la charla se habilita una sesión de preguntas de 15 minutos.  Número aprox de asistentes: 25  Posterior a la sesión, se armará un grupo de WhatsApp donde durante 2 semanas el coach estará presente para responder aclarar dudas que vayan surgiendo en el equipo de trabajo. (opcional)', unitario: 590000 },
                adicionales: [
                    { label: 'Personalizacion', descripcion: 'A la estrucutra base, podemos agregar slides que tengan relación con el uso específico del cliente. Por ejemplo explorar y mostrar como se podría usar la IA en cierta área o industria. Se realiza la charla en las oficinas del cliente o similar.', unitario: 250000 },
                    { label: 'Workshop', descripcion: 'Al finalizar la charla, tras un break de 15 minutos los asistentes se separan en grupos. Se designan roles dentro del grupo. A cada grupo se le entregará un desafío o tarea el cual deberán resolver aplicando lo visto en la charla anterior.  Este punrto es clave para que "metan las manos" y se den cuenta ellos mismos de lo potente de las herramientas cuando se usan correctamente.  Se les dará 30 minutos para avanzar lo más posible. Al finalizar cada grupo nos cuenta brevemente su experiencia.', unitario: 350000 }
                ],
                packs: [
                    { label: 'Capacitación ChatGPT y otras plataformas IA', descripcion: 'Se realiza la charla en las oficinas del cliente o similar.  En esta capacitación no solo se abordará ChatGPT, también creación de imagenes, videos y plataforma de Agentes.  Duración: 90 minutos Número aprox de asistentes: 25', unitario: 1250000 }
                ]
            })
        };

        var svc46 = {
            id: 'demo-svc-videos-con-ia',
            nombre: 'Videos con IA',
            name: 'Videos con IA',
            categoria: 'Producción',
            descripcion: '',
            precio_base: 590000,
            activo: true,
            featured: false,
            tarifario: JSON.stringify({
                base: { label: 'Video', descripcion: 'Utilizando plataformas IA y técnicas de prompting, crearemos una pieza audiovisual sin sonido.  Duración: 10 segundos Formato: mp4 Tamaño: 9:16  Utilizando Generative AI Image, crearemos la imagen con la que inicia el video y una imagen con la que termina. Utilizando Generative AI Video y una descripción detallada de la escena, le pediremos a la IA que interprete el movimiento de inicio a fin.', unitario: 590000 },
                adicionales: [],
                packs: []
            })
        };

        var svc47 = {
            id: 'demo-svc-videos',
            nombre: 'Videos',
            name: 'Videos',
            categoria: 'Producción',
            descripcion: '',
            precio_base: 1950000,
            activo: true,
            featured: true,
            tarifario: JSON.stringify({
                base: { label: 'Creación videos billboard.', descripcion: 'Crearemos 3 videos de hasta 30 segundos de duración. Cada video generará el efecto de pantalla 3d donde un objeto sale de la pantalla (ilusión óptica). El mejor resultado de este efecto se obtiene cuando la pantalla es curva. Si la pantalla fuera plana o terminara en ángulo recto, igual se logra el efecto pero en menor calidad. Cada video no incluye sonido.  Formato de entrega: .mp4 Duración: Hasta 30 segundos Resolución: Nos deben decir la resolución de la pantalla. Tiempo de entrega: 2 semanas desde la aprobación. Cambios: 2', unitario: 1950000 },
                adicionales: [],
                packs: []
            })
        };

        storage.ServicesService.importMany([svc1, svc2, svc3, svc4, svc5, svc6, svc7, svc8, svc9, svc10, svc11, svc12, svc13, svc14, svc15, svc16, svc17, svc18, svc19, svc20, svc21, svc22, svc23, svc24, svc25, svc26, svc27, svc28, svc29, svc30, svc31, svc32, svc33, svc34, svc35, svc36, svc37, svc38, svc39, svc40, svc41, svc42, svc43, svc44, svc45, svc46, svc47]);
    }

    function loadDemoData(storage, now) {
        // ── Clientes ───────────────────────────────────────────────────────
        storage.ClientsService.importMany([
            { id: 'demo-cli-acme',   name: 'ACME Corp',        nombre: 'ACME Corp'        },
            { id: 'demo-cli-banco',  name: 'Banco Ejemplo',    nombre: 'Banco Ejemplo'    },
            { id: 'demo-cli-retail', name: 'Retail Chile SpA', nombre: 'Retail Chile SpA' }
        ]);

        // ── Bodega ─────────────────────────────────────────────────────────
        storage.BodegaService.importMany([
            { id: 'demo-eq-1', equipo_id: 'CAM-001', nombre: 'Cámara Glambot v2',  categoria: 'Cámaras',    estado: 'bueno',          notas: 'Sensor limpio, sin rayones.' },
            { id: 'demo-eq-2', equipo_id: 'CAM-002', nombre: 'GoPro Hero 11',       categoria: 'Cámaras',    estado: 'bueno',          notas: 'Incluye 3 baterías.' },
            { id: 'demo-eq-3', equipo_id: 'NB-001',  nombre: 'MacBook Pro 16"',     categoria: 'Notebooks',  estado: 'bueno',          notas: 'Software Glambot instalado.' },
            { id: 'demo-eq-4', equipo_id: 'NB-002',  nombre: 'Dell XPS 15',         categoria: 'Notebooks',  estado: 'mantenimiento',  notas: 'Pantalla con línea horizontal, revisando.' },
            { id: 'demo-eq-5', equipo_id: 'IMP-001', nombre: 'Impresora DNP DS820', categoria: 'Impresoras', estado: 'bueno',          notas: 'Rollos: 2 disponibles.' },
            { id: 'demo-eq-6', equipo_id: 'HOL-001', nombre: 'Holobox 65"',         categoria: 'Pantallas',  estado: 'bueno',          notas: 'Verificar HDMI antes del evento.' }
        ]);

        // ── Ventas ─────────────────────────────────────────────────────────

        // Sale 1: triggers sin_contacto
        var sale1 = {
            id: 'demo-sale-1',
            sourceId: '1001',
            clientName: 'ACME Corp',
            eventName: 'Lanzamiento Producto ACME',
            eventDate: daysFromNow(10),
            serviceIds: ['demo-svc-glambot'],
            serviceNames: 'Glambot',
            amount: 600000,
            status: 'confirmada',
            boardColumn: 2,
            checklist: [
                { key: 'pre_coordinacion', label: 'Coordinación del evento',      group: 'Coordinación', checked: false, checkedAt: null },
                { key: 'pre_diseno_ok',    label: 'Diseño aprobado por cliente',   group: 'Coordinación', checked: true,  checkedAt: new Date().toISOString() },
                { key: 'pre_nomina_env',   label: 'Nómina enviada al personal',    group: 'Personal',     checked: true,  checkedAt: new Date().toISOString() }
            ],
            traspaso: {
                contactoNombre: 'Carlos Mendoza',
                contactoTel: '+56998765432',
                contactoEmail: 'carlos@acme.cl',
                lugar: 'Centro de Eventos CasaPiedra, Vitacura',
                horarioServicio: '18:00 – 21:00',
                horarioMontaje: '15:00 – 17:30',
                horarioDesmontaje: '21:00 – 22:30',
                vestimenta: 'Negra sin logos (estándar MazeLab)',
                pax: 150,
                notaVendedor: 'Evento corporativo. Quieren cobertura en el hall principal.'
            }
        };

        // Sale 2: triggers sin_diseno
        var sale2 = {
            id: 'demo-sale-2',
            sourceId: '1002',
            clientName: 'Banco Ejemplo',
            eventName: 'Aniversario Banco 50 años',
            eventDate: daysFromNow(5),
            serviceIds: ['demo-svc-glambot', 'demo-svc-holobox'],
            serviceNames: 'Glambot, Holobox',
            amount: 980000,
            status: 'confirmada',
            boardColumn: 3,
            checklist: [
                { key: 'pre_coordinacion', label: 'Coordinación del evento',      group: 'Coordinación', checked: true,  checkedAt: new Date().toISOString() },
                { key: 'pre_diseno_ok',    label: 'Diseño aprobado por cliente',   group: 'Coordinación', checked: false, checkedAt: null },
                { key: 'pre_nomina_env',   label: 'Nómina enviada al personal',    group: 'Personal',     checked: true,  checkedAt: new Date().toISOString() }
            ],
            traspaso: {
                contactoNombre: 'Paola Riquelme',
                contactoTel: '+56912345678',
                contactoEmail: 'paola@banco.cl',
                lugar: 'Av. Apoquindo 4500, Las Condes, Santiago',
                horarioServicio: '19:00 – 22:00',
                horarioMontaje: '16:00 – 18:30',
                horarioDesmontaje: '22:00 – 23:30',
                vestimenta: 'Negra sin logos (estándar MazeLab)',
                pax: 200,
                notaVendedor: 'Cliente muy ordenado, quiere prueba técnica el día anterior. Confirmar acceso al subterráneo.'
            }
        };

        // Sale 3: triggers sin_nomina
        var sale3 = {
            id: 'demo-sale-3',
            sourceId: '1003',
            clientName: 'Retail Chile SpA',
            eventName: 'Inauguración Tienda Mall Costanera',
            eventDate: daysFromNow(3),
            serviceIds: ['demo-svc-holobox'],
            serviceNames: 'Holobox',
            amount: 420000,
            status: 'confirmada',
            boardColumn: 3,
            checklist: [
                { key: 'pre_coordinacion', label: 'Coordinación del evento',      group: 'Coordinación', checked: true,  checkedAt: new Date().toISOString() },
                { key: 'pre_diseno_ok',    label: 'Diseño aprobado por cliente',   group: 'Coordinación', checked: true,  checkedAt: new Date().toISOString() },
                { key: 'pre_nomina_env',   label: 'Nómina enviada al personal',    group: 'Personal',     checked: false, checkedAt: null }
            ],
            traspaso: {
                contactoNombre: 'Javiera Torres',
                contactoTel: '+56911223344',
                contactoEmail: 'javiera@retailchile.cl',
                lugar: 'Mall Costanera Center, Nivel 1',
                horarioServicio: '11:00 – 18:00',
                horarioMontaje: '08:00 – 10:30',
                horarioDesmontaje: '18:00 – 19:30',
                vestimenta: 'Polo Retail Chile provisto por el cliente',
                pax: 500,
                notaVendedor: 'Evento público, alto tráfico. Coordinar seguridad.'
            }
        };

        // Sale 4: triggers sin_equipos
        var sale4 = {
            id: 'demo-sale-4',
            sourceId: '1004',
            clientName: 'ACME Corp',
            eventName: 'Workshop ACME Innovación',
            eventDate: daysFromNow(2),
            serviceIds: ['demo-svc-glambot'],
            serviceNames: 'Glambot',
            amount: 550000,
            status: 'confirmada',
            boardColumn: 4,
            checklist: [
                { key: 'pre_coordinacion', label: 'Coordinación del evento',      group: 'Coordinación', checked: true,  checkedAt: new Date().toISOString() },
                { key: 'pre_diseno_ok',    label: 'Diseño aprobado por cliente',   group: 'Coordinación', checked: true,  checkedAt: new Date().toISOString() },
                { key: 'pre_nomina_env',   label: 'Nómina enviada al personal',    group: 'Personal',     checked: true,  checkedAt: new Date().toISOString() }
            ],
            equiposAsignados: [],
            traspaso: {
                contactoNombre: 'Felipe Araya',
                contactoTel: '+56955667788',
                contactoEmail: 'felipe@acme.cl',
                lugar: 'Hotel W Santiago, Salón Patagonia',
                horarioServicio: '09:00 – 13:00',
                horarioMontaje: '07:00 – 08:30',
                horarioDesmontaje: '13:00 – 14:00',
                vestimenta: 'Negra sin logos (estándar MazeLab)',
                pax: 80,
                notaVendedor: 'Workshop cerrado. Solo ejecutivos. Equipo debe estar a las 7 AM.'
            }
        };

        // Sale 5: triggers no_retornado
        var sale5 = {
            id: 'demo-sale-5',
            sourceId: '1005',
            clientName: 'Banco Ejemplo',
            eventName: 'Cena de Fin de Año Banco',
            eventDate: daysFromNow(-1),
            serviceIds: ['demo-svc-glambot'],
            serviceNames: 'Glambot',
            amount: 700000,
            status: 'confirmada',
            boardColumn: 5,
            checklist: [
                { key: 'pre_coordinacion', label: 'Coordinación del evento',      group: 'Coordinación', checked: true,  checkedAt: new Date().toISOString() },
                { key: 'pre_diseno_ok',    label: 'Diseño aprobado por cliente',   group: 'Coordinación', checked: true,  checkedAt: new Date().toISOString() },
                { key: 'pre_nomina_env',   label: 'Nómina enviada al personal',    group: 'Personal',     checked: true,  checkedAt: new Date().toISOString() }
            ],
            equiposAsignados: [
                { itemId: 'item_eq_1', label: 'Cámara principal Glambot', serviceId: 'demo-svc-glambot', serviceName: 'Glambot', equipoId: 'demo-eq-1', equipoDisplayId: 'CAM-001', estadoSalida: 'bueno', retornado: false, estadoRetorno: null, notaRetorno: '' },
                { itemId: 'item_eq_2', label: 'Notebook operador',       serviceId: 'demo-svc-glambot', serviceName: 'Glambot', equipoId: 'demo-eq-3', equipoDisplayId: 'NB-001',  estadoSalida: 'bueno', retornado: false, estadoRetorno: null, notaRetorno: '' },
                { itemId: 'item_eq_3', label: 'Impresora DNP DS820',     serviceId: 'demo-svc-glambot', serviceName: 'Glambot', equipoId: 'demo-eq-5', equipoDisplayId: 'IMP-001', estadoSalida: 'bueno', retornado: false, estadoRetorno: null, notaRetorno: '' }
            ],
            traspaso: {
                contactoNombre: 'Paola Riquelme',
                contactoTel: '+56912345678',
                contactoEmail: 'paola@banco.cl',
                lugar: 'Hotel Ritz Carlton, Santiago',
                horarioServicio: '20:00 – 01:00',
                horarioMontaje: '17:00 – 19:30',
                horarioDesmontaje: '01:00 – 02:30',
                vestimenta: 'Traje formal negro',
                pax: 300,
                notaVendedor: 'Evento de gala. Equipos pendientes de retorno.'
            }
        };

        storage.SalesService.importMany([sale1, sale2, sale3, sale4, sale5]);

        // ── Cotizaciones ──────────────────────────────────────────────────
        var cot1 = {
            id: 'demo-cot-1',
            codigo: 'COT-001',
            version: 1,
            clientName: 'ACME Corp',
            contactName: 'Carlos Mendoza',
            contactEmail: 'carlos@acme.cl',
            contactTel: '+56998765432',
            eventName: 'Lanzamiento Producto ACME',
            eventDate: daysFromNow(10),
            lugar: 'Centro de Eventos CasaPiedra, Vitacura',
            validezDias: 7,
            condiciones: '50% adelanto, 50% a 30 días',
            estado: 'enviada',
            bloques: [
                {
                    serviceId: 'demo-svc-glambot',
                    serviceName: 'Glambot',
                    descripcion: 'Brazo robótico con iPhone 13 para videos dinámicos.',
                    linkFotos: '',
                    linkLanding: '',
                    items: [
                        { tipo: 'base', label: 'Glambot 2 hrs', descripcion: 'Incluye montaje, traslado, 2 técnicos', unitario: 950000, cantidad: 1, total: 950000 },
                        { tipo: 'adicional', label: 'Print Station por hora', descripcion: 'Impresión instantánea con logo', unitario: 65000, cantidad: 3, total: 195000 },
                        { tipo: 'adicional', label: 'Movimiento personalizado', descripcion: 'Diseño a medida', unitario: 150000, cantidad: 1, total: 150000 }
                    ],
                    subtotalBloque: 1295000
                }
            ],
            subtotal: 1295000,
            descuento: 295000,
            descuentoPct: 22.8,
            descuentoNota: 'Descuento cliente frecuente',
            totalNeto: 1000000,
            notas: 'Cliente pidió precio cerrado en 1M.',
            saleId: null,
            createdAt: new Date().toISOString()
        };

        var cot2 = {
            id: 'demo-cot-2',
            codigo: 'COT-002',
            version: 1,
            clientName: 'Banco Ejemplo',
            contactName: 'Paola Riquelme',
            contactEmail: 'paola@banco.cl',
            contactTel: '+56912345678',
            eventName: 'Aniversario Banco 50 años',
            eventDate: daysFromNow(5),
            lugar: 'Av. Apoquindo 4500, Las Condes',
            validezDias: 7,
            condiciones: '50% adelanto, 50% a 30 días',
            estado: 'aprobada',
            bloques: [
                {
                    serviceId: 'demo-svc-glambot',
                    serviceName: 'Glambot',
                    descripcion: 'Brazo robótico para videos.',
                    linkFotos: '',
                    linkLanding: '',
                    items: [
                        { tipo: 'base', label: 'Glambot 2 hrs', descripcion: 'Incluye montaje, traslado, 2 técnicos', unitario: 950000, cantidad: 1, total: 950000 }
                    ],
                    subtotalBloque: 950000
                },
                {
                    serviceId: 'demo-svc-holobox',
                    serviceName: 'Holobox',
                    descripcion: 'Display holográfico.',
                    linkFotos: '',
                    linkLanding: '',
                    items: [
                        { tipo: 'base', label: 'Holobox jornada', descripcion: 'Montaje, contenido, técnico, traslado', unitario: 380000, cantidad: 1, total: 380000 },
                        { tipo: 'adicional', label: 'Contenido personalizado', descripcion: 'Animación 3D con branding', unitario: 250000, cantidad: 1, total: 250000 }
                    ],
                    subtotalBloque: 630000
                }
            ],
            subtotal: 1580000,
            descuento: 600000,
            descuentoPct: 38,
            descuentoNota: 'Pack 2 activaciones',
            totalNeto: 980000,
            notas: '',
            saleId: 'demo-sale-2',
            createdAt: new Date().toISOString()
        };

        storage.CotizacionesService.importMany([cot1, cot2]);

        console.log('Demo data loaded: 3 clientes, 5 ventas, 6 equipos bodega, 2 cotizaciones.');
    }

    // storage.js is already loaded (before us in index.html), run immediately
    load();
})();
