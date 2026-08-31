import { Injectable } from '@nestjs/common';
import { Subject, Observable } from 'rxjs';

export interface NotificationEvent {
  employeeId: string;
  type: string;
  title: string;
  body: string;
  entityType?: string;
  entityId?: string;
}

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
