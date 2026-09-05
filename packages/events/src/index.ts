export type EventValidator<TEvent> = (input: unknown) => TEvent;
export type EventListener<TEvent> = (event: TEvent) => void;

export interface EventSubscriptionOptions {
  type?: string;
}

interface Subscription<TEvent> {
  listener: EventListener<TEvent>;
  type?: string;
}

export class EventDispatchError<TEvent> extends AggregateError {
  readonly event: TEvent;

  constructor(event: TEvent, errors: unknown[]) {
    super(errors, `${errors.length} event listener(s) failed`);
    this.name = "EventDispatchError";
    this.event = event;
  }
}

/**
 * Small synchronous in-process bus.
 *
 * Validation is injected by the composition root so this package stays generic,
 * while Totem core supplies validateTotemEvent from @totem/protocol. Listener
 * registration order is delivery order. A failing listener does not prevent
 * later listeners from observing the event; failures are reported after the
 * complete dispatch.
 */
export class EventBus<TEvent extends { type: string }> {
  readonly #validate: EventValidator<TEvent>;
  readonly #subscriptions: Subscription<TEvent>[] = [];

  constructor(validate: EventValidator<TEvent>) {
    this.#validate = validate;
  }

  get subscriberCount(): number {
    return this.#subscriptions.length;
  }

  subscribe(
    listener: EventListener<TEvent>,
    options: EventSubscriptionOptions = {},
  ): () => void {
    const subscription: Subscription<TEvent> = {
      listener,
      ...(options.type === undefined ? {} : { type: options.type }),
    };
    this.#subscriptions.push(subscription);

    let active = true;
    return () => {
      if (!active) return;
      active = false;
      const index = this.#subscriptions.indexOf(subscription);
      if (index >= 0) this.#subscriptions.splice(index, 1);
    };
  }

  subscribeType(type: string, listener: EventListener<TEvent>): () => void {
    return this.subscribe(listener, { type });
  }

  publish(input: unknown): TEvent {
    const event = this.#validate(input);
    const errors: unknown[] = [];

    // Snapshot the current set: subscribing/unsubscribing during a listener does
    // not retroactively change delivery of the event already being dispatched.
    for (const subscription of [...this.#subscriptions]) {
      if (subscription.type !== undefined && subscription.type !== event.type) {
        continue;
      }
      try {
        subscription.listener(event);
      } catch (error) {
        errors.push(error);
      }
    }

    if (errors.length > 0) throw new EventDispatchError(event, errors);
    return event;
  }
}
