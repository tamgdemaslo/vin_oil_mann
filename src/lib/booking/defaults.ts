export type BookingWorkingHour = {
  weekday: number;
  isWorking: boolean;
  startTime: string | null;
  endTime: string | null;
};

export const DEFAULT_BOOKING_STEP_MINUTES = 30;

export const DEFAULT_BOOKING_WORKING_HOURS: BookingWorkingHour[] = Array.from({ length: 7 }, (_, index) => ({
  weekday: index + 1,
  isWorking: index < 6,
  startTime: index < 6 ? "09:00" : null,
  endTime: index < 6 ? "19:00" : null,
}));

export function defaultBookingWorkingHour(weekday: number) {
  return DEFAULT_BOOKING_WORKING_HOURS.find((row) => row.weekday === weekday) ?? null;
}
