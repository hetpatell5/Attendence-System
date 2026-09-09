import { Injectable } from '@nestjs/common';
import { Subject, Observable } from 'rxjs';
import { filter } from 'rxjs/operators';

export interface NotificationEvent {
  employeeId: string;
  type: string;
  title: string;
  body: string;
  entityType?: string;
  entityId?: string;
}

/**
 * Special sentinel used to broadcast to ALL connected employee SSE streams.
 * Employee SSE subscriptions also subscribe to this channel so a single emit
 * reaches every logged-in employee instantly.
 */
export const EMPLOYEE_BROADCAST_CHANNEL = 'employee:broadcast';

/**
 * Simple in-process event bus for real-time notification push via SSE.
 * When a notification is created, `emit()` is called so that any connected
 * SSE stream for the targeted employee / admin is immediately notified.
 */
@Injectable()
export class NotificationEventBus {
  private readonly subject = new Subject<NotificationEvent>();

  /** Push an event to all active SSE subscribers. */
  emit(event: NotificationEvent): void {
    this.subject.next(event);
  }

  /**
   * Broadcast an event to every connected employee SSE stream at once.
   * Uses the special EMPLOYEE_BROADCAST_CHANNEL sentinel so the controller
   * doesn't need to enumerate individual employee IDs.
   */
  broadcastToAllEmployees(event: Omit<NotificationEvent, 'employeeId'>): void {
    this.subject.next({ ...event, employeeId: EMPLOYEE_BROADCAST_CHANNEL });
  }

  /** Returns an observable that emits only events for the given employeeId. */
  forEmployee(employeeId: string): Observable<NotificationEvent> {
    return new Observable((subscriber) => {
      const sub = this.subject.subscribe((event) => {
        if (event.employeeId === employeeId) {
          subscriber.next(event);
        }
      });
      return () => sub.unsubscribe();
    });
  }

  /**
   * Returns an observable for a specific employee that ALSO receives
   * broadcast events (EMPLOYEE_BROADCAST_CHANNEL).
   * Use this for employee SSE streams so they receive both personal and
   * organisation-wide events (e.g. announcements).
   */
  forEmployeeWithBroadcast(employeeId: string): Observable<NotificationEvent> {
    return new Observable((subscriber) => {
      const sub = this.subject
        .pipe(
          filter(
            (e) =>
              e.employeeId === employeeId ||
              e.employeeId === EMPLOYEE_BROADCAST_CHANNEL,
          ),
        )
        .subscribe((event) => subscriber.next(event));
      return () => sub.unsubscribe();
    });
  }

  /** Returns an observable that emits events for any of the given employee IDs. */
  forAny(employeeIds: string[]): Observable<NotificationEvent> {
    const set = new Set(employeeIds);
    return new Observable((subscriber) => {
      const sub = this.subject.subscribe((event) => {
        if (set.has(event.employeeId)) {
          subscriber.next(event);
        }
      });
      return () => sub.unsubscribe();
    });
  }

  /** Returns the raw global stream (for admin who wants all events). */
  all(): Observable<NotificationEvent> {
    return this.subject.asObservable();
  }
}
