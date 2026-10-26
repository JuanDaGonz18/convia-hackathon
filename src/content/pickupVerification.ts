/**
 * Texts for the pickup check ("Verificar mi carro"). The server only sends
 * reason codes; every code it can return, plus the app's own, has a text here.
 */

export type PickupClientReason =
  | 'offline'
  | 'auth_required'
  | 'recording_failed'
  | 'frames_failed'
  | 'upload_failed'
  | 'network_error'
  | 'not_found'
  | 'not_accepted'
  | 'unsupported_vehicle';

type RetryText = { title: string; text: string; tips?: string[] };

const FILMING_TIPS = [
  'Apunta a la parte de adelante o de atrás del carro, donde está la placa.',
  'Graba cuando el carro esté a pocos metros y casi detenido.',
  'Mantén el celular quieto durante los 3 segundos.',
];

export const PICKUP_TEXTS = {
  screen: {
    kicker: 'VERIFICAR MI CARRO',
    title: '¿Es este tu carro?',
    intro: 'Graba 3 segundos del carro que llega. Revisamos con IA que la placa, la marca y el color sean los del viaje. El video se borra apenas termina la verificación.',
    expected: 'Debe ser',
    record: 'Grabar 3 segundos',
    recording: (seconds: number) => `Grabando… ${seconds}`,
    stop: 'Detener',
    cameraNeeded: 'Necesitamos la cámara para grabar el carro.',
    cameraBlocked: 'La cámara está bloqueada para ConVía. Actívala en los ajustes del teléfono.',
    openSettings: 'Abrir ajustes del teléfono',
    allowCamera: 'Permitir cámara',
    webUnavailable: 'La verificación con video está disponible en la app para Android e iPhone.',
    back: 'Volver',
    mock: 'Modo de prueba: resultado simulado, sin IA real.',
  },
  stages: {
    uploading: 'Subiendo el video…',
    analyzing: 'Buscando el carro y la placa…',
    verifying: 'Comparando placa, marca y color…',
  },
  verified: {
    title: 'Es tu viaje',
    text: (driver: string) => `La placa, la marca y el color coinciden con el carro de ${driver}.`,
    done: 'Listo',
  },
  mismatch: {
    title: 'No te subas',
    text: 'Este carro no coincide con el de tu viaje.',
    plate_mismatch: (read: string, expected: string) => `Leímos la placa ${read}, pero tu viaje es en ${expected}.`,
    brand_mismatch: (read: string, expected: string) => `La placa coincide, pero el carro es un ${read} y tu viaje es en un ${expected}. Podría ser una placa copiada.`,
    color_mismatch: (read: string, expected: string) => `La placa coincide, pero el carro es ${read} y el de tu viaje es ${expected}. Podría ser una placa copiada.`,
    call: 'Llamar al conductor',
    chat: 'Escribirle al conductor',
    report: 'Reportar',
    reported: 'Gracias. Reportamos este carro para revisarlo.',
    reportFailed: 'No se pudo enviar el reporte. Inténtalo de nuevo.',
    cancel: 'Cancelar el viaje',
    cancelTitle: '¿Cancelar tu viaje?',
    cancelMessage: 'Liberarás tu cupo y el conductor recibirá un aviso.',
    cancelConfirm: 'Sí, cancelar',
    cancelBack: 'Volver',
    cancelled: 'Cancelaste el viaje.',
    cancelFailed: 'No se pudo cancelar el viaje.',
    retry: 'Grabar de nuevo',
  },
  retryAction: 'Grabar de nuevo',
  retry: {
    // Server: the clip
    clip_unreadable: { title: 'No pudimos abrir el video', text: 'Graba de nuevo con la cámara de ConVía.' },
    clip_too_long: { title: 'El video es muy largo', text: 'Graba máximo 3 segundos.' },
    frame_missing: { title: 'No pudimos revisar el video', text: 'Graba de nuevo, por favor.' },
    // Server: what SAM saw
    no_car: { title: 'No vimos un carro', text: 'Apunta al carro que llega y grábalo completo.', tips: FILMING_TIPS },
    no_plate: { title: 'No se vio la placa', text: 'Graba la parte de adelante o de atrás del carro.', tips: FILMING_TIPS },
    // Server: what Muse Spark read
    not_live_photo: { title: 'Graba el carro directamente', text: 'Parece una pantalla o una foto impresa.' },
    poor_quality: { title: 'El video quedó borroso u oscuro', text: 'Graba de nuevo con el celular quieto.', tips: FILMING_TIPS },
    plate_unreadable: { title: 'No pudimos leer la placa', text: 'Acércate un poco y que la placa se vea entera, sin reflejos.', tips: FILMING_TIPS },
    low_confidence: { title: 'No estamos seguros de la placa', text: 'Graba de nuevo con la placa más cerca y bien iluminada.', tips: FILMING_TIPS },
    plate_uncertain: { title: 'No leímos la placa con claridad', text: 'Graba de nuevo más cerca de la placa antes de decidir.', tips: FILMING_TIPS },
    vehicle_uncertain: { title: 'No pudimos confirmar el carro', text: 'La placa coincide, pero no estamos seguros de la marca o el color. Compáralos tú mismo o graba de nuevo con buena luz.', tips: FILMING_TIPS },
    // Server: models and limits
    timeout: { title: 'La verificación tardó demasiado', text: 'Inténtalo de nuevo en un momento.' },
    rate_limited: { title: 'Hay muchas verificaciones en curso', text: 'Espera unos segundos y vuelve a intentarlo.' },
    service_unavailable: { title: 'El servicio no está disponible', text: 'Inténtalo de nuevo en unos minutos. Mientras tanto, compara la placa tú mismo.' },
    bad_model_response: { title: 'No pudimos analizar el video', text: 'Graba de nuevo, por favor.' },
    too_many_attempts: { title: 'Hiciste muchos intentos', text: 'Compara la placa tú mismo o escríbele al conductor.' },
    server_error: { title: 'Algo falló de nuestro lado', text: 'Inténtalo de nuevo en un momento.' },
    // App
    offline: { title: 'Sin conexión con el servidor', text: 'La verificación del carro requiere conexión.' },
    auth_required: { title: 'Tu sesión expiró', text: 'Vuelve a iniciar sesión.' },
    recording_failed: { title: 'No se pudo grabar', text: 'Inténtalo de nuevo.' },
    frames_failed: { title: 'No pudimos leer el video', text: 'Graba de nuevo, por favor.' },
    upload_failed: { title: 'No se pudo subir el video', text: 'Revisa tu conexión e inténtalo de nuevo.' },
    network_error: { title: 'No pudimos conectar con la verificación', text: 'Revisa tu conexión e inténtalo de nuevo.' },
    not_found: { title: 'No encontramos tu viaje', text: 'Vuelve a tus solicitudes e inténtalo de nuevo.' },
    not_accepted: { title: 'Tu viaje no está activo', text: 'La verificación está disponible cuando tu solicitud está aceptada y el viaje no ha terminado.' },
    unsupported_vehicle: { title: 'No disponible para este vehículo', text: 'La verificación con IA funciona solo con placas de carro (3 letras y 3 números).' },
  } satisfies Record<string, RetryText>,
} as const;

/** Text for a retry reason; unknown codes get a generic text instead of failing. */
export function retryText(reason: string): RetryText {
  return (PICKUP_TEXTS.retry as Record<string, RetryText>)[reason] ?? PICKUP_TEXTS.retry.server_error;
}
