export class BookingError extends Error {
  status: number;
  code: string;
  details?: unknown;

  constructor(message: string, code = "booking_error", status = 400, details?: unknown) {
    super(message);
    this.name = "BookingError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function bookingErrorPayload(error: unknown, logUnexpected = true) {
  if (error instanceof BookingError) {
    return {
      status: error.status,
      body: { error: error.message, code: error.code, details: error.details },
    };
  }
  if (logUnexpected) console.error("booking request failed", error);
  return {
    status: 500,
    body: { error: "Не удалось выполнить операцию с записью", code: "booking_internal_error" },
  };
}
