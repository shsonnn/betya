/* A measured SVG stroke keeps the Figma-style hand-drawn outline crisp at every size. */
(() => {
  const selector = ".game-settings-frame, .dice-panel .player, .play-area .die-cube, .sketch-input-frame, .chip-list, .chip, .primary-button, .roll-button, .room-leave, .room-code-button, .member-avatar, .chat-message > p, .chat-emoji-bubble, .chat-input-shell";
  const watched = new WeakSet();
  const resizeObserver = new ResizeObserver((entries) => {
    for (const { target } of entries) draw(target);
  });

  function wave(position, seed) {
    return Math.sin(position * .36 + seed) * .58 + Math.sin(position * .17 + seed * 1.7) * .42;
  }

  function draw(element) {
    const svg = element.querySelector(":scope > .sketch-outline");
    if (!svg) return;
    const { width, height } = svg.getBoundingClientRect();
    if (width < 20 || height < 20) return;
    const w = Math.round(width * 10) / 10;
    const h = Math.round(height * 10) / 10;
    if (element.classList.contains("member-avatar")) {
      const stroke = Number.parseFloat(getComputedStyle(element).getPropertyValue("--sketch-width")) || 1.3;
      const radius = (Math.min(w, h) - stroke) / 2 - .2;
      const cx = w / 2;
      const cy = h / 2;
      let circle = "";
      for (let i = 0; i < 40; i += 1) {
        const angle = -Math.PI / 2 + i * Math.PI / 20;
        const ripple = Math.sin(i * .94 + 2.1) * .45 + Math.sin(i * 1.79 + 1.4) * .24;
        circle += `${i ? " L" : "M"} ${(cx + (radius + ripple) * Math.cos(angle)).toFixed(2)} ${(cy + (radius + ripple) * Math.sin(angle)).toFixed(2)}`;
      }
      svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
      svg.querySelector("path").setAttribute("d", `${circle} Z`);
      return;
    }
    const panel = element.classList.contains("game-settings-frame");
    const die = element.classList.contains("die-cube");
    const button = element.matches(".primary-button, .roll-button");
    const chatBubble = element.matches(".chat-message > p, .chat-emoji-bubble");
    const chatInput = element.classList.contains("chat-input-shell");
    const headerButton = element.matches(".room-leave, .room-code-button");
    const edge = panel || die ? 2.6 : button ? 1.8 : headerButton || chatBubble || chatInput ? .9 : 1.5;
    const radius = button ? 14 : headerButton ? 5 : chatBubble ? 4 : panel || die ? 9 : 8;
    const amplitude = panel ? 1.3 : die ? 1.1 : button ? 1 : chatBubble || chatInput || headerButton ? .5 : .75;
    const seed = panel ? 2.4 : die ? 5.2 : button ? 3.4 : headerButton ? 4.1 : Number(element.dataset.player || 0) + 1.8;
    let d = `M ${edge + radius} ${edge}`;
    for (let x = edge + radius + 8; x < w - edge - radius; x += 8) d += ` L ${x.toFixed(1)} ${(edge + amplitude * wave(x, seed)).toFixed(2)}`;
    d += ` L ${w - edge - radius} ${edge} Q ${w - edge} ${edge} ${w - edge} ${edge + radius}`;
    for (let y = edge + radius + 8; y < h - edge - radius; y += 8) d += ` L ${(w - edge + amplitude * wave(y, seed + 2)).toFixed(2)} ${y.toFixed(1)}`;
    d += ` L ${w - edge} ${h - edge - radius} Q ${w - edge} ${h - edge} ${w - edge - radius} ${h - edge}`;
    for (let x = w - edge - radius - 8; x > edge + radius; x -= 8) d += ` L ${x.toFixed(1)} ${(h - edge + amplitude * wave(x, seed + 4)).toFixed(2)}`;
    d += ` L ${edge + radius} ${h - edge} Q ${edge} ${h - edge} ${edge} ${h - edge - radius}`;
    for (let y = h - edge - radius - 8; y > edge + radius; y -= 8) d += ` L ${(edge + amplitude * wave(y, seed + 6)).toFixed(2)} ${y.toFixed(1)}`;
    d += ` L ${edge} ${edge + radius} Q ${edge} ${edge} ${edge + radius} ${edge} Z`;
    svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
    svg.querySelector("path").setAttribute("d", d);
  }

  function attach() {
    document.querySelectorAll(selector).forEach((element) => {
      if (watched.has(element) && element.querySelector(":scope > .sketch-outline")) return;
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.classList.add("sketch-outline");
      svg.setAttribute("aria-hidden", "true");
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("fill", "none");
      path.setAttribute("vector-effect", "non-scaling-stroke");
      svg.append(path);
      element.append(svg);
      element.classList.add("has-sketch-outline");
      if (!watched.has(element)) {
        watched.add(element);
        resizeObserver.observe(element);
      }
      draw(element);
    });
  }

  new MutationObserver(attach).observe(document.body, { childList: true, subtree: true });
  attach();
})();
