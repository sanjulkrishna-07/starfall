(() => {
  'use strict';

  const WIDTH = 960;
  const HEIGHT = 600;
  const canvas = document.querySelector('#game-canvas');
  const context = canvas.getContext('2d');
  const scoreValue = document.querySelector('#score-value');
  const bestValue = document.querySelector('#best-value');
  const levelValue = document.querySelector('#level-value');
  const stateLayer = document.querySelector('#state-layer');
  const stateKicker = document.querySelector('#state-kicker');
  const stateIcon = document.querySelector('#state-icon');
  const stateTitle = document.querySelector('#state-title');
  const stateCopy = document.querySelector('#state-copy');
  const stateHint = document.querySelector('#state-hint');
  const startButton = document.querySelector('#start-button');
  const startButtonLabel = document.querySelector('#start-button-label');
  const pauseButton = document.querySelector('#pause-button');
  const announcer = document.querySelector('#announcer');

  const heldKeys = new Set();
  const heldTouchDirections = new Set();
  const pointerDirections = new Map();
  const backgroundStars = [];
  const particles = [];
  const meteors = [];
  const stars = [];
  const directionsByKey = new Map([
    ['ArrowUp', 'up'], ['w', 'up'], ['W', 'up'],
    ['ArrowDown', 'down'], ['s', 'down'], ['S', 'down'],
    ['ArrowLeft', 'left'], ['a', 'left'], ['A', 'left'],
    ['ArrowRight', 'right'], ['d', 'right'], ['D', 'right'],
  ]);

  let gameState = 'ready';
  let score = 0;
  let bestScore = readBestScore();
  let level = 1;
  let elapsed = 0;
  let meteorClock = 0;
  let starClock = 0;
  let animationClock = 0;
  let lastFrame = 0;
  let nextEntityId = 1;
  let player = { x: WIDTH / 2, y: HEIGHT - 82, radius: 18, speed: 330 };

  for (let index = 0; index < 100; index += 1) {
    const seed = (index * 73 + 19) % 997;
    backgroundStars.push({
      x: (seed * 37) % WIDTH,
      y: (seed * 67) % HEIGHT,
      size: .65 + (seed % 4) * .35,
      phase: seed * .19,
      tint: seed % 7 === 0 ? 'violet' : seed % 11 === 0 ? 'mint' : 'white',
    });
  }

  bestValue.textContent = formatScore(bestScore);
  showState('ready');
  requestAnimationFrame(frame);

  startButton.addEventListener('click', startGame);
  pauseButton.addEventListener('click', togglePause);

  document.querySelectorAll('.direction-button').forEach((button) => {
    const direction = button.dataset.direction;
    button.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      button.setPointerCapture(event.pointerId);
      pointerDirections.set(event.pointerId, direction);
      refreshTouchDirections();
    });
    const release = (event) => {
      pointerDirections.delete(event.pointerId);
      refreshTouchDirections();
    };
    button.addEventListener('pointerup', release);
    button.addEventListener('pointercancel', release);
    button.addEventListener('lostpointercapture', release);
    button.addEventListener('contextmenu', (event) => event.preventDefault());
  });

  document.addEventListener('keydown', (event) => {
    const target = event.target;
    const isButton = target instanceof HTMLElement && target.closest('button, a, input, select, textarea');
    const direction = directionsByKey.get(event.key);

    if (direction) {
      event.preventDefault();
      heldKeys.add(direction);
      return;
    }
    if ((event.code === 'Space' || event.key === ' ') && !isButton) {
      event.preventDefault();
      if (!event.repeat) handleSpace();
      return;
    }
    if ((event.key === 'p' || event.key === 'P') && !isButton) {
      event.preventDefault();
      if (!event.repeat) togglePause();
    }
  });

  document.addEventListener('keyup', (event) => {
    const direction = directionsByKey.get(event.key);
    if (direction) heldKeys.delete(direction);
  });

  window.addEventListener('blur', clearInputs);
  document.addEventListener('visibilitychange', () => {
    clearInputs();
    if (document.hidden && gameState === 'playing') pauseGame();
  });

  function frame(timestamp) {
    if (!lastFrame) lastFrame = timestamp;
    const delta = Math.min((timestamp - lastFrame) / 1000, .04);
    lastFrame = timestamp;
    animationClock += delta;

    if (gameState === 'playing') update(delta);
    draw();
    requestAnimationFrame(frame);
  }

  function update(delta) {
    elapsed += delta;
    level = 1 + Math.floor(elapsed / 18);
    levelValue.textContent = String(level).padStart(2, '0');

    let horizontal = Number(heldKeys.has('right') || heldTouchDirections.has('right'))
      - Number(heldKeys.has('left') || heldTouchDirections.has('left'));
    let vertical = Number(heldKeys.has('down') || heldTouchDirections.has('down'))
      - Number(heldKeys.has('up') || heldTouchDirections.has('up'));
    const magnitude = Math.hypot(horizontal, vertical) || 1;
    if (horizontal || vertical) {
      player.x += (horizontal / magnitude) * player.speed * delta;
      player.y += (vertical / magnitude) * player.speed * delta;
    }
    player.x = clamp(player.x, 28, WIDTH - 28);
    player.y = clamp(player.y, 35, HEIGHT - 34);

    meteorClock += delta;
    starClock += delta;
    const meteorInterval = Math.max(.39, 1.25 - level * .085);
    const starInterval = Math.max(.52, 1.03 - level * .022);
    if (meteorClock >= meteorInterval) {
      meteorClock = 0;
      spawnMeteor();
    }
    if (starClock >= starInterval) {
      starClock = 0;
      spawnStar();
    }

    for (let index = meteors.length - 1; index >= 0; index -= 1) {
      const meteor = meteors[index];
      meteor.y += meteor.speed * delta;
      meteor.rotation += meteor.spin * delta;
      if (meteor.y - meteor.radius > HEIGHT + 4) {
        meteors.splice(index, 1);
        continue;
      }
      if (distance(player.x, player.y, meteor.x, meteor.y) < player.radius + meteor.radius * .77) {
        endGame();
        return;
      }
    }

    for (let index = stars.length - 1; index >= 0; index -= 1) {
      const star = stars[index];
      star.y += star.drift * delta;
      star.wobble += delta * 2.6;
      if (star.y > HEIGHT + 24) {
        stars.splice(index, 1);
        continue;
      }
      if (distance(player.x, player.y, star.x, star.y) < player.radius + star.radius) {
        stars.splice(index, 1);
        collectStar(star.x, star.y);
      }
    }

    for (let index = particles.length - 1; index >= 0; index -= 1) {
      const particle = particles[index];
      particle.life -= delta;
      particle.x += particle.vx * delta;
      particle.y += particle.vy * delta;
      particle.vx *= .985;
      particle.vy *= .985;
      if (particle.life <= 0) particles.splice(index, 1);
    }
  }

  function draw() {
    context.clearRect(0, 0, WIDTH, HEIGHT);
    drawBackground();
    drawPlayfieldGlow();
    stars.forEach(drawStar);
    meteors.forEach(drawMeteor);
    particles.forEach(drawParticle);
    if (gameState !== 'gameover') drawPilot();
  }

  function drawBackground() {
    const gradient = context.createLinearGradient(0, 0, WIDTH, HEIGHT);
    gradient.addColorStop(0, '#111432');
    gradient.addColorStop(.52, '#0a1128');
    gradient.addColorStop(1, '#11112c');
    context.fillStyle = gradient;
    context.fillRect(0, 0, WIDTH, HEIGHT);

    const nebula = context.createRadialGradient(WIDTH * .72, HEIGHT * .24, 5, WIDTH * .72, HEIGHT * .24, 420);
    nebula.addColorStop(0, 'rgba(116, 91, 189, .15)');
    nebula.addColorStop(1, 'rgba(116, 91, 189, 0)');
    context.fillStyle = nebula;
    context.fillRect(0, 0, WIDTH, HEIGHT);

    for (const star of backgroundStars) {
      const twinkle = .48 + Math.sin(animationClock * 1.8 + star.phase) * .2;
      context.globalAlpha = twinkle;
      context.fillStyle = star.tint === 'violet' ? '#bcb3ff' : star.tint === 'mint' ? '#98f3dc' : '#e4e6ff';
      context.beginPath();
      context.arc(star.x, star.y, star.size, 0, Math.PI * 2);
      context.fill();
    }
    context.globalAlpha = 1;

    context.strokeStyle = 'rgba(173, 177, 231, .025)';
    context.lineWidth = 1;
    for (let y = 0; y < HEIGHT; y += 50) {
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(WIDTH, y);
      context.stroke();
    }
  }

  function drawPlayfieldGlow() {
    const glow = context.createRadialGradient(player.x, player.y, 10, player.x, player.y, 180);
    glow.addColorStop(0, 'rgba(118, 227, 222, .1)');
    glow.addColorStop(1, 'rgba(118, 227, 222, 0)');
    context.fillStyle = glow;
    context.fillRect(player.x - 180, player.y - 180, 360, 360);
  }

  function drawStar(star) {
    const pulse = 1 + Math.sin(star.wobble) * .09;
    context.save();
    context.translate(star.x, star.y);
    context.rotate(Math.sin(star.wobble * .45) * .17);
    context.scale(pulse, pulse);
    context.shadowColor = '#ffdc76';
    context.shadowBlur = 22;
    starPath(context, 0, 0, star.radius, star.radius * .46, 5);
    context.fillStyle = '#ffe38a';
    context.fill();
    context.shadowBlur = 0;
    context.beginPath();
    context.arc(-star.radius * .2, -star.radius * .24, 1.8, 0, Math.PI * 2);
    context.fillStyle = '#fff8cf';
    context.fill();
    context.restore();
  }

  function drawMeteor(meteor) {
    context.save();
    context.translate(meteor.x, meteor.y);
    context.rotate(meteor.rotation);
    const tail = context.createLinearGradient(0, -meteor.radius * 2.2, 0, 0);
    tail.addColorStop(0, 'rgba(255, 111, 98, 0)');
    tail.addColorStop(.7, 'rgba(255, 125, 106, .13)');
    tail.addColorStop(1, 'rgba(255, 153, 119, .45)');
    context.fillStyle = tail;
    context.beginPath();
    context.moveTo(-meteor.radius * .56, -meteor.radius * .2);
    context.lineTo(-meteor.radius * .4, -meteor.radius * 2.35);
    context.lineTo(meteor.radius * .42, -meteor.radius * 2.2);
    context.lineTo(meteor.radius * .57, -meteor.radius * .1);
    context.closePath();
    context.fill();

    const rockGradient = context.createRadialGradient(-meteor.radius * .34, -meteor.radius * .42, 2, 0, 0, meteor.radius * 1.4);
    rockGradient.addColorStop(0, '#ffd2ae');
    rockGradient.addColorStop(.3, '#f58d79');
    rockGradient.addColorStop(1, '#894966');
    context.beginPath();
    for (let point = 0; point < meteor.points.length; point += 1) {
      const angle = (point / meteor.points.length) * Math.PI * 2;
      const radius = meteor.radius * meteor.points[point];
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius;
      if (point === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    }
    context.closePath();
    context.shadowColor = 'rgba(255, 130, 106, .34)';
    context.shadowBlur = 17;
    context.fillStyle = rockGradient;
    context.fill();
    context.shadowBlur = 0;
    context.strokeStyle = 'rgba(255, 210, 176, .37)';
    context.lineWidth = 1.3;
    context.stroke();
    context.beginPath();
    context.arc(-meteor.radius * .2, -meteor.radius * .12, meteor.radius * .15, 0, Math.PI * 2);
    context.fillStyle = 'rgba(93, 42, 72, .5)';
    context.fill();
    context.restore();
  }

  function drawPilot() {
    const x = player.x;
    const y = player.y;
    const bob = gameState === 'playing' ? Math.sin(animationClock * 8) * 1.5 : Math.sin(animationClock * 2) * 2;
    context.save();
    context.translate(x, y + bob);
    context.shadowColor = 'rgba(108, 239, 223, .35)';
    context.shadowBlur = 24;
    context.fillStyle = 'rgba(111, 244, 224, .13)';
    context.beginPath();
    context.ellipse(0, 19, 16, 5, 0, 0, Math.PI * 2);
    context.fill();
    context.shadowBlur = 0;

    context.fillStyle = '#b0f3e6';
    context.strokeStyle = '#f4fff2';
    context.lineWidth = 1.3;
    context.beginPath();
    context.roundRect(-12, -1, 24, 23, 9);
    context.fill();
    context.stroke();
    context.fillStyle = '#74cfc9';
    context.beginPath();
    context.roundRect(-8, 3, 16, 11, 5);
    context.fill();
    context.fillStyle = '#d9fff0';
    context.beginPath();
    context.arc(-3, 7, 1.25, 0, Math.PI * 2);
    context.arc(3, 7, 1.25, 0, Math.PI * 2);
    context.fill();

    context.strokeStyle = '#a9eadc';
    context.lineWidth = 4;
    context.lineCap = 'round';
    context.beginPath();
    context.moveTo(-11, 5); context.lineTo(-16, 12);
    context.moveTo(11, 5); context.lineTo(16, 12);
    context.stroke();
    context.strokeStyle = '#8edbcc';
    context.lineWidth = 5;
    context.beginPath();
    context.moveTo(-6, 20); context.lineTo(-8, 25);
    context.moveTo(6, 20); context.lineTo(8, 25);
    context.stroke();
    context.fillStyle = '#ffd97a';
    context.shadowColor = '#ffd97a';
    context.shadowBlur = 10;
    context.beginPath();
    context.arc(0, -9, 3.5, 0, Math.PI * 2);
    context.fill();
    context.restore();
  }

  function drawParticle(particle) {
    const alpha = clamp(particle.life / particle.maxLife, 0, 1);
    context.globalAlpha = alpha;
    context.fillStyle = particle.color;
    context.beginPath();
    context.arc(particle.x, particle.y, particle.size * (.5 + alpha * .5), 0, Math.PI * 2);
    context.fill();
    context.globalAlpha = 1;
  }

  function spawnMeteor() {
    const radius = 16 + Math.random() * 12 + Math.min(level, 7) * .7;
    const points = Array.from({ length: 9 }, () => .76 + Math.random() * .36);
    meteors.push({
      id: nextEntityId++,
      x: 38 + Math.random() * (WIDTH - 76),
      y: -radius - 6,
      radius,
      points,
      speed: 175 + Math.random() * 75 + (level - 1) * 24,
      rotation: Math.random() * Math.PI * 2,
      spin: (Math.random() - .5) * 1.6,
    });
  }

  function spawnStar() {
    const radius = 11 + Math.random() * 2;
    stars.push({
      id: nextEntityId++,
      x: 30 + Math.random() * (WIDTH - 60),
      y: -radius - 4,
      radius,
      drift: 58 + Math.random() * 42 + (level - 1) * 3,
      wobble: Math.random() * Math.PI * 2,
    });
  }

  function collectStar(x, y) {
    score += 10;
    scoreValue.textContent = formatScore(score);
    if (score > bestScore) {
      bestScore = score;
      bestValue.textContent = formatScore(bestScore);
      saveBestScore(bestScore);
    }
    burst(x, y, '#ffe28a', 12);
  }

  function burst(x, y, color, count) {
    for (let index = 0; index < count; index += 1) {
      const angle = (Math.PI * 2 * index) / count + Math.random() * .3;
      const speed = 45 + Math.random() * 120;
      particles.push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        color,
        size: 1.5 + Math.random() * 2,
        life: .32 + Math.random() * .38,
        maxLife: .7,
      });
    }
  }

  function startGame() {
    score = 0;
    elapsed = 0;
    level = 1;
    meteorClock = .35;
    starClock = .18;
    player = { x: WIDTH / 2, y: HEIGHT - 82, radius: 18, speed: 330 };
    meteors.length = 0;
    stars.length = 0;
    particles.length = 0;
    scoreValue.textContent = formatScore(score);
    levelValue.textContent = '01';
    clearInputs();
    gameState = 'playing';
    stateLayer.hidden = true;
    pauseButton.hidden = false;
    pauseButton.setAttribute('aria-label', 'Pause game');
    announcer.textContent = 'Game started. Collect the golden stars and avoid the falling meteors.';
  }

  function endGame() {
    burst(player.x, player.y, '#ff9c89', 22);
    gameState = 'gameover';
    pauseButton.hidden = true;
    clearInputs();
    showState('gameover');
  }

  function pauseGame() {
    if (gameState !== 'playing') return;
    gameState = 'paused';
    clearInputs();
    pauseButton.setAttribute('aria-label', 'Resume game');
    showState('paused');
  }

  function resumeGame() {
    if (gameState !== 'paused') return;
    gameState = 'playing';
    stateLayer.hidden = true;
    pauseButton.setAttribute('aria-label', 'Pause game');
    announcer.textContent = 'Game resumed.';
  }

  function togglePause() {
    if (gameState === 'playing') pauseGame();
    else if (gameState === 'paused') resumeGame();
  }

  function handleSpace() {
    if (gameState === 'ready' || gameState === 'gameover') startGame();
    else if (gameState === 'playing') pauseGame();
    else if (gameState === 'paused') resumeGame();
  }

  function showState(state) {
    stateLayer.hidden = false;
    if (state === 'ready') {
      stateKicker.textContent = 'READY, STAR PILOT?';
      stateIcon.textContent = '✦';
      stateTitle.textContent = 'The sky is yours.';
      stateCopy.textContent = 'Collect the golden stars. Keep clear of the falling meteors.';
      startButtonLabel.textContent = 'Start playing';
      stateHint.innerHTML = 'or press <kbd>Space</kbd>';
      startButton.onclick = startGame;
      announcer.textContent = 'Game ready. Press Space or Start playing.';
    } else if (state === 'paused') {
      stateKicker.textContent = 'TIME TO CATCH YOUR BREATH';
      stateIcon.textContent = 'Ⅱ';
      stateTitle.textContent = 'Paused among the stars.';
      stateCopy.textContent = `You have ${score} points. The meteor shower will be waiting.`;
      startButtonLabel.textContent = 'Keep playing';
      stateHint.innerHTML = 'or press <kbd>Space</kbd> to continue';
      startButton.onclick = resumeGame;
      announcer.textContent = `Game paused. Your score is ${score}.`;
    } else if (state === 'gameover') {
      stateKicker.textContent = 'THAT WAS A CLOSE ONE';
      stateIcon.textContent = '✧';
      stateTitle.textContent = 'Meteor shower!';
      stateCopy.textContent = `You caught ${score} points of stardust. Ready for another flight?`;
      startButtonLabel.textContent = 'Play again';
      stateHint.innerHTML = 'or press <kbd>Space</kbd> to fly again';
      startButton.onclick = startGame;
      announcer.textContent = `Game over. Final score ${score}. Press Space or Play again to restart.`;
    }
  }

  function refreshTouchDirections() {
    heldTouchDirections.clear();
    pointerDirections.forEach((direction) => heldTouchDirections.add(direction));
    document.querySelectorAll('.direction-button').forEach((button) => {
      button.classList.toggle('is-held', heldTouchDirections.has(button.dataset.direction));
    });
  }

  function clearInputs() {
    heldKeys.clear();
    pointerDirections.clear();
    refreshTouchDirections();
  }

  function starPath(ctx, x, y, outerRadius, innerRadius, points) {
    ctx.beginPath();
    for (let index = 0; index < points * 2; index += 1) {
      const radius = index % 2 === 0 ? outerRadius : innerRadius;
      const angle = (index * Math.PI) / points - Math.PI / 2;
      const pointX = x + Math.cos(angle) * radius;
      const pointY = y + Math.sin(angle) * radius;
      if (index === 0) ctx.moveTo(pointX, pointY);
      else ctx.lineTo(pointX, pointY);
    }
    ctx.closePath();
  }

  function readBestScore() {
    try { return Number(window.localStorage.getItem('starfall-best')) || 0; }
    catch { return 0; }
  }

  function saveBestScore(value) {
    try { window.localStorage.setItem('starfall-best', String(value)); }
    catch { /* The game remains playable when storage is unavailable. */ }
  }

  function formatScore(value) { return String(value).padStart(4, '0'); }
  function clamp(value, minimum, maximum) { return Math.max(minimum, Math.min(maximum, value)); }
  function distance(x1, y1, x2, y2) { return Math.hypot(x1 - x2, y1 - y2); }
})();

