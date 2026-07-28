/**
 * Entrada normalizada: teclado, ratón/orbita y táctil, todo detrás de una sola
 * superficie muestreada por frame.
 *
 * Los subsistemas NUNCA leen eventos DOM. Leen el estado ya muestreado, que es
 * estable durante todo el frame: si `update()` y `lateUpdate()` preguntan si se
 * pulsó saltar, ambos ven la misma respuesta.
 */

export interface PointerState {
  /** Delta acumulado del frame, en píxeles. */
  dx: number;
  dy: number;
  /** Delta de rueda del frame. */
  wheel: number;
  down: boolean;
  /** Posición normalizada [-1,1] con Y hacia arriba. */
  ndcX: number;
  ndcY: number;
}

export class Input {
  readonly pointer: PointerState = { dx: 0, dy: 0, wheel: 0, down: false, ndcX: 0, ndcY: 0 };

  private held = new Set<string>();
  private pressedThisFrame = new Set<string>();
  private releasedThisFrame = new Set<string>();
  private pendingPress = new Set<string>();
  private pendingRelease = new Set<string>();
  private attached = false;

  constructor(private readonly canvas: HTMLCanvasElement) {}

  attach(): void {
    if (this.attached) return;
    this.attached = true;
    addEventListener('keydown', this.onKeyDown);
    addEventListener('keyup', this.onKeyUp);
    addEventListener('blur', this.onBlur);
    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    addEventListener('pointermove', this.onPointerMove);
    addEventListener('pointerup', this.onPointerUp);
    this.canvas.addEventListener('wheel', this.onWheel, { passive: false });
    this.canvas.addEventListener('contextmenu', this.onContextMenu);
  }

  detach(): void {
    if (!this.attached) return;
    this.attached = false;
    removeEventListener('keydown', this.onKeyDown);
    removeEventListener('keyup', this.onKeyUp);
    removeEventListener('blur', this.onBlur);
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    removeEventListener('pointermove', this.onPointerMove);
    removeEventListener('pointerup', this.onPointerUp);
    this.canvas.removeEventListener('wheel', this.onWheel);
    this.canvas.removeEventListener('contextmenu', this.onContextMenu);
  }

  /** ¿La tecla está mantenida ahora mismo? `code` de KeyboardEvent, p.ej. 'KeyW'. */
  down(code: string): boolean {
    return this.held.has(code);
  }

  /** ¿Bajó en este frame? */
  pressed(code: string): boolean {
    return this.pressedThisFrame.has(code);
  }

  /** ¿Subió en este frame? */
  released(code: string): boolean {
    return this.releasedThisFrame.has(code);
  }

  /** Eje a partir de dos teclas, en [-1,1]. */
  axis(negative: string, positive: string): number {
    return (this.held.has(positive) ? 1 : 0) - (this.held.has(negative) ? 1 : 0);
  }

  /** Vuelca los eventos acumulados al estado del frame. Lo llama el Engine. */
  beginFrame(): void {
    this.pressedThisFrame = this.pendingPress;
    this.releasedThisFrame = this.pendingRelease;
    this.pendingPress = new Set();
    this.pendingRelease = new Set();
  }

  /** Consume los deltas. Lo llama el Engine tras el render. */
  endFrame(): void {
    this.pointer.dx = 0;
    this.pointer.dy = 0;
    this.pointer.wheel = 0;
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.repeat) return;
    this.held.add(e.code);
    this.pendingPress.add(e.code);
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.held.delete(e.code);
    this.pendingRelease.add(e.code);
  };

  private onBlur = (): void => {
    // Sin esto, alt-tab durante un movimiento deja la tecla pegada para siempre.
    for (const code of this.held) this.pendingRelease.add(code);
    this.held.clear();
    this.pointer.down = false;
  };

  private onPointerDown = (e: PointerEvent): void => {
    this.pointer.down = true;
    this.updateNdc(e);
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (this.pointer.down) {
      this.pointer.dx += e.movementX || 0;
      this.pointer.dy += e.movementY || 0;
    }
    this.updateNdc(e);
  };

  private onPointerUp = (): void => {
    this.pointer.down = false;
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    this.pointer.wheel += e.deltaY;
  };

  private onContextMenu = (e: Event): void => e.preventDefault();

  private updateNdc(e: PointerEvent): void {
    const r = this.canvas.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return;
    this.pointer.ndcX = ((e.clientX - r.left) / r.width) * 2 - 1;
    this.pointer.ndcY = -(((e.clientY - r.top) / r.height) * 2 - 1);
  }
}
