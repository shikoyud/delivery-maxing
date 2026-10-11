export const ACTIONS = ['move', 'look', 'jump', 'crouch', 'sprint', 'interact', 'hit', 'board'] as const;
export type Action = (typeof ACTIONS)[number];

export interface ButtonState {
  held: boolean;
  pressed: boolean;
}

/**
 * One tick of player intent.
 * move.x: strafe-right positive; move.y: forward positive; length <= 1.
 * look.yaw: 0 faces -Z, positive turns left (three.js convention).
 */
export interface InputFrame {
  move: { x: number; y: number };
  look: { yaw: number; pitch: number };
  jump: ButtonState;
  crouch: ButtonState;
  sprint: ButtonState;
  interact: ButtonState;
  hit: ButtonState;
  board: ButtonState;
}

const button = (): ButtonState => ({ held: false, pressed: false });

export function emptyInput(): InputFrame {
  return {
    move: { x: 0, y: 0 },
    look: { yaw: 0, pitch: 0 },
    jump: button(),
    crouch: button(),
    sprint: button(),
    interact: button(),
    hit: button(),
    board: button(),
  };
}
