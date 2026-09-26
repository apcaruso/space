// Placeholder until step 7: an empty 480x270 screen with integer upscaling.

const WIDTH = 480;
const HEIGHT = 270;

const canvas = document.querySelector<HTMLCanvasElement>('#screen');
if (canvas === null) throw new Error('missing #screen canvas');

canvas.width = WIDTH;
canvas.height = HEIGHT;

// Integer scale in device pixels, so one game pixel is always an exact block of screen pixels.
function fit(target: HTMLCanvasElement): void {
  const dpr = window.devicePixelRatio || 1;
  const scale = Math.max(
    1,
    Math.floor(Math.min((window.innerWidth * dpr) / WIDTH, (window.innerHeight * dpr) / HEIGHT)),
  );
  target.style.width = `${(WIDTH * scale) / dpr}px`;
  target.style.height = `${(HEIGHT * scale) / dpr}px`;
}

fit(canvas);
window.addEventListener('resize', () => fit(canvas));

const ctx = canvas.getContext('2d');
if (ctx !== null) {
  ctx.fillStyle = '#05040c';
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
}
