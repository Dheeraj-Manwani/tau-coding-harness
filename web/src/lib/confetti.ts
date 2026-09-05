const CONFETTI_COLORS = [
  "#58a6ff",
  "#a78bfa",
  "#f472b6",
  "#facc15",
  "#34d399",
  "#fb923c",
] as const;

/** A short, dependency-free celebration for successful promo redemptions. */
export function celebratePromoRedemption(): void {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  const layer = document.createElement("div");
  layer.setAttribute("aria-hidden", "true");
  Object.assign(layer.style, {
    position: "fixed",
    inset: "0",
    zIndex: "2147483647",
    overflow: "hidden",
    pointerEvents: "none",
  });
  document.body.append(layer);

  const animations: Animation[] = [];
  const originX = window.innerWidth / 2;
  const originY = Math.min(window.innerHeight * 0.34, 300);

  for (let index = 0; index < 72; index += 1) {
    const piece = document.createElement("i");
    const angle = Math.random() * Math.PI * 2;
    const distance = 130 + Math.random() * 360;
    const x = Math.cos(angle) * distance;
    const y = Math.sin(angle) * distance + 260 + Math.random() * 170;
    const rotation = 360 + Math.random() * 1080;
    const width = 5 + Math.random() * 7;

    Object.assign(piece.style, {
      position: "absolute",
      left: `${originX}px`,
      top: `${originY}px`,
      width: `${width}px`,
      height: `${width * (0.45 + Math.random() * 0.9)}px`,
      borderRadius: Math.random() > 0.65 ? "50%" : "2px",
      background: CONFETTI_COLORS[index % CONFETTI_COLORS.length],
      willChange: "transform, opacity",
    });
    layer.append(piece);

    animations.push(
      piece.animate(
        [
          { transform: "translate(-50%, -50%) scale(.7) rotate(0deg)", opacity: 1 },
          {
            transform: `translate(calc(-50% + ${x * 0.65}px), calc(-50% + ${y * 0.25 - 130}px)) scale(1) rotate(${rotation * 0.45}deg)`,
            opacity: 1,
            offset: 0.55,
          },
          {
            transform: `translate(calc(-50% + ${x}px), calc(-50% + ${y}px)) scale(.85) rotate(${rotation}deg)`,
            opacity: 0,
          },
        ],
        {
          duration: 1_150 + Math.random() * 650,
          delay: Math.random() * 120,
          easing: "cubic-bezier(.15,.75,.25,1)",
          fill: "forwards",
        },
      ),
    );
  }

  void Promise.allSettled(animations.map((animation) => animation.finished)).then(
    () => layer.remove(),
  );
}
