/** Rozmiar pliku do wyświetlenia (np. „2,0 MB”, „340 KB”, „512 B”). */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
}

/** Komunikat dla odpowiedzi serwera spoza kontraktu (np. błąd sieci, strona błędu zamiast JSON-a). */
export const UPLOAD_GENERIC_ERROR = "Nie udało się dodać pliku. Sprawdź połączenie i spróbuj ponownie.";

/** Wyciąga komunikat z odpowiedzi JSON serwera; każdy nieznany kształt daje komunikat ogólny. */
export function uploadErrorMessage(body: unknown): string {
  if (typeof body === "object" && body !== null) {
    const message = Reflect.get(body, "message");
    if (typeof message === "string" && message.length > 0 && message.length <= 300) {
      return message;
    }
  }
  return UPLOAD_GENERIC_ERROR;
}
