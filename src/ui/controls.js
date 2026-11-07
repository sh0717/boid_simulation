import { DEFAULTS, DEFAULT_SEED, MAX_OBSTACLES, PRESETS } from '../config.js';

const byId = (id) => document.getElementById(id);
const SLIDERS = [
  'cohesion',
  'alignment',
  'separation',
  'speed',
  'perception',
  'fieldOfView',
  'goalSpeed',
  'goalStrength',
  'predatorSpeed',
  'predatorRadius',
  'predatorStrength',
  'boundaryMargin',
  'boundaryStrength',
];
const SWITCHES = ['goal', 'predator', 'obstacles', 'trails', 'bounds', 'inspect', 'goalPath'];

export class ControlPanel {
  constructor(settings, actions) {
    this.settings = settings;
    this.actions = actions;
    this.abort = new AbortController();
    this.toastTimer = null;
    try {
      this.selectedObstacleId = actions.obstacles()[0]?.id ?? null;
      const on = (target, type, callback) =>
        target.addEventListener(type, callback, { signal: this.abort.signal });
      for (const key of SLIDERS)
        on(byId(key), 'input', (event) => {
          actions.configure({ [key]: Number(event.target.value) });
          if (['cohesion', 'alignment', 'separation'].includes(key))
            byId('preset').value = 'custom';
          this.syncSlider(key);
          if (key === 'goalSpeed' || key === 'goalStrength') this.syncGoal();
        });
      for (const key of SWITCHES)
        on(byId(key), 'change', (event) => {
          actions.configure({ [key]: event.target.checked });
          if (key === 'trails') actions.resetTrails();
          byId('predator-legend').hidden = !settings.predator;
          this.sync();
        });
      for (const button of document.querySelectorAll('button[data-count]'))
        on(button, 'click', () => {
          if (settings.count === Number(button.dataset.count)) return;
          actions.configure({ count: Number(button.dataset.count) });
          actions.restart();
          this.sync();
          this.notify(`${settings.count.toLocaleString()}개 개체로 다시 시작합니다.`);
        });
      on(byId('preset'), 'change', (event) => {
        const preset = PRESETS[event.target.value];
        if (!preset) return;
        actions.configure({
          cohesion: preset.cohesion,
          alignment: preset.alignment,
          separation: preset.separation,
        });
        this.sync();
        this.notify(`${preset.label} 규칙을 적용했습니다.`);
      });
      on(byId('play-pause'), 'click', () => actions.togglePause());
      on(byId('restart'), 'click', () => {
        actions.restart();
        this.notify('같은 초기 배치로 다시 시작합니다.');
      });
      on(byId('single-step'), 'click', () => actions.singleStep());
      on(byId('inspect-toggle'), 'click', () => {
        actions.configure({ inspect: !settings.inspect });
        this.sync();
      });
      on(byId('selected-boid'), 'change', (event) => {
        const value = event.target.valueAsNumber;
        if (!Number.isInteger(value) || value < 1 || value > settings.count) {
          this.notify(`1~${settings.count} 사이의 개체 번호를 입력하세요.`);
          event.target.value = actions.selected() + 1;
          return;
        }
        actions.select(value - 1);
        this.sync();
      });
      on(byId('next-boid'), 'click', () => {
        actions.select((actions.selected() + 1) % settings.count);
        this.sync();
      });
      on(byId('color-mode'), 'change', (event) => {
        actions.configure({ colorMode: event.target.value });
        this.sync();
      });
      on(byId('search-type'), 'change', (event) => {
        actions.configure({ searchType: event.target.value });
        this.sync();
        this.notify(
          `${event.target.value === 'grid' ? '균일 격자' : 'kd-tree'} 탐색을 적용했습니다.`,
        );
      });
      on(byId('apply-seed'), 'click', () => {
        const seed = byId('seed').valueAsNumber;
        if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
          this.notify('시드는 0~4294967295 사이의 정수여야 합니다.');
          return;
        }
        actions.restart(seed);
        this.notify(`시드 ${seed}의 배치를 적용했습니다.`);
      });
      on(byId('new-seed'), 'click', () => {
        const seed = crypto.getRandomValues(new Uint32Array(1))[0];
        actions.restart(seed);
        this.notify(`새 배치 · 시드 ${seed}`);
      });
      on(byId('camera-reset'), 'click', () => {
        actions.resetCamera();
        this.notify('카메라를 초기화했습니다.');
      });
      on(byId('auto-rotate'), 'click', () => {
        actions.configure({ autoRotate: !settings.autoRotate });
        this.sync();
      });
      on(byId('restore'), 'click', () => {
        actions.configure(DEFAULTS);
        actions.resetWorld();
        this.selectedObstacleId = actions.obstacles()[0]?.id ?? null;
        this.obstacleFeedback('');
        this.worldFeedback('');
        byId('preset').value = 'balanced';
        actions.restart(DEFAULT_SEED);
        actions.resetCamera();
        this.sync();
        this.notify('기본 설정을 복원했습니다.');
      });
      const applyWorld = () => {
        try {
          const patch = Object.fromEntries(
            ['width', 'height', 'depth'].map((key) => [key, byId(`world-${key}`).valueAsNumber]),
          );
          actions.resizeWorld(patch);
          this.sync();
          this.worldFeedback('맵 크기를 적용했습니다. 현재 시간과 재생 상태를 유지합니다.');
        } catch (error) {
          if (!(error instanceof RangeError || error instanceof TypeError)) throw error;
          this.worldFeedback(error.message, true);
        }
      };
      on(byId('apply-world'), 'click', applyWorld);
      on(byId('boundaryMode'), 'change', (event) => {
        actions.configure({ boundaryMode: event.target.value });
        this.sync();
      });
      on(byId('world-fields'), 'keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          applyWorld();
        }
      });
      const editObstacle = (operation) => {
        try {
          operation();
          this.sync();
          this.obstacleFeedback('장애물 배치를 적용했습니다.');
        } catch (error) {
          if (!(error instanceof RangeError || error instanceof TypeError)) throw error;
          this.obstacleFeedback(error.message, true);
        }
      };
      for (const type of ['sphere', 'box'])
        on(byId(`add-${type}`), 'click', () =>
          editObstacle(() => {
            this.selectedObstacleId = actions.addObstacle(type);
          }),
        );
      on(byId('selected-obstacle'), 'change', (event) =>
        this.selectObstacle(Number(event.target.value)),
      );
      const applyObstacle = () =>
        editObstacle(() => {
          const item = actions
            .obstacles()
            .find((obstacle) => obstacle.id === this.selectedObstacleId);
          if (!item) return;
          const keys =
            item.type === 'sphere'
              ? ['x', 'y', 'z', 'radius']
              : ['x', 'y', 'z', 'width', 'height', 'depth'];
          const patch = Object.fromEntries(
            keys.map((key) => [key, byId(`obstacle-${key}`).valueAsNumber]),
          );
          actions.updateObstacle(item.id, patch);
        });
      on(byId('apply-obstacle'), 'click', applyObstacle);
      on(byId('obstacle-fields'), 'keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          applyObstacle();
        }
      });
      on(byId('remove-obstacle'), 'click', () =>
        editObstacle(() => actions.removeObstacle(this.selectedObstacleId)),
      );
      on(byId('reset-obstacles'), 'click', () =>
        editObstacle(() => {
          actions.resetObstacles();
          this.selectedObstacleId = actions.obstacles()[0]?.id ?? null;
        }),
      );
      const dialog = byId('help-dialog');
      on(byId('help-open'), 'click', () => dialog.showModal());
      on(byId('help-close'), 'click', () => dialog.close());
      on(dialog, 'click', (event) => {
        if (event.target === dialog) {
          const r = dialog.getBoundingClientRect();
          if (
            event.clientX < r.left ||
            event.clientX > r.right ||
            event.clientY < r.top ||
            event.clientY > r.bottom
          )
            dialog.close();
        }
      });
      const fullscreen = byId('fullscreen');
      fullscreen.hidden = !document.fullscreenEnabled;
      on(fullscreen, 'click', async () => {
        try {
          if (document.fullscreenElement) await document.exitFullscreen();
          else await byId('viewport').requestFullscreen();
        } catch {
          this.notify('이 브라우저에서는 전체 화면을 사용할 수 없습니다.');
        }
      });
      on(document, 'fullscreenchange', () =>
        fullscreen.setAttribute(
          'aria-label',
          document.fullscreenElement ? '전체 화면 종료' : '전체 화면',
        ),
      );
      on(window, 'keydown', (event) => {
        if (event.repeat || event.ctrlKey || event.altKey || event.metaKey || dialog.open) return;
        if (event.target.closest('input, select, button, textarea, a, [contenteditable]')) return;
        if (event.code === 'Space') {
          event.preventDefault();
          actions.togglePause();
        }
        if (event.code === 'KeyR') {
          actions.restart();
          this.notify('같은 초기 배치로 다시 시작합니다.');
        }
        if (event.code === 'KeyC') actions.resetCamera();
        if (event.code === 'Period') {
          event.preventDefault();
          actions.singleStep();
        }
      });
      this.sync();
      byId('settings').disabled = false;
      byId('play-pause').disabled = false;
      byId('restart').disabled = false;
    } catch (error) {
      this.dispose();
      throw error;
    }
  }

  syncSlider(key) {
    const input = byId(key);
    input.value = this.settings[key];
    const percent =
      ((Number(input.value) - Number(input.min)) / (Number(input.max) - Number(input.min))) * 100;
    input.style.setProperty('--fill', `${percent}%`);
    const value = this.settings[key];
    byId(`${key}-value`).value = ['perception', 'predatorRadius', 'boundaryMargin'].includes(key)
      ? `${value} u`
      : key === 'predatorSpeed'
        ? `${value} u/s`
        : key === 'fieldOfView'
          ? `${value}°`
          : `${value.toFixed(2)}${['speed', 'goalSpeed', 'goalStrength', 'predatorStrength', 'boundaryStrength'].includes(key) ? '×' : ''}`;
  }

  sync() {
    for (const key of SLIDERS) this.syncSlider(key);
    for (const key of SWITCHES) byId(key).checked = this.settings[key];
    for (const button of document.querySelectorAll('button[data-count]'))
      button.setAttribute(
        'aria-pressed',
        String(Number(button.dataset.count) === this.settings.count),
      );
    byId('count-value').value = this.settings.count.toLocaleString();
    byId('auto-rotate').setAttribute('aria-pressed', String(this.settings.autoRotate));
    byId('predator-legend').hidden = !this.settings.predator;
    this.syncGoal();
    byId('inspect-toggle').setAttribute('aria-pressed', String(this.settings.inspect));
    byId('inspection-card').hidden = !this.settings.inspect;
    byId('selected-boid').max = this.settings.count;
    byId('selected-boid').value = this.actions.selected() + 1;
    byId('seed').value = this.actions.seed();
    byId('color-mode').value = this.settings.colorMode;
    byId('search-type').value = this.settings.searchType;
    byId('color-legend').hidden = this.settings.colorMode === 'natural';
    const density = this.settings.colorMode === 'density';
    byId('color-legend-title').textContent = density ? 'VISIBLE NEIGHBORS' : 'SPEED / u·s⁻¹';
    byId('color-min').textContent = density ? '0' : '5';
    byId('color-max').textContent = density ? '64+' : '12';
    byId('color-ramp').classList.toggle('density', density);
    this.syncObstacles();
    const bounds = this.actions.bounds();
    for (const key of ['width', 'height', 'depth']) byId(`world-${key}`).value = bounds[key];
    byId('world-size-label').textContent = `${bounds.width} × ${bounds.height} × ${bounds.depth}`;
    byId('boundaryMode').value = this.settings.boundaryMode;
    for (const key of ['boundaryMargin', 'boundaryStrength'])
      byId(key).disabled = this.settings.boundaryMode === 'hard';
    byId('boundary-description').textContent = {
      hard: 'Hard: Boid가 벽에 닿으면 위치를 제한하고 바깥쪽 속도를 즉시 반사합니다. 포식자는 벽에서 바깥쪽 속도를 제거합니다. Soft에서 전환하면 경계 밖 개체를 즉시 보정합니다.',
      soft: 'Soft: Boid는 회피 힘으로 돌아오며 일시적으로 맵 밖을 날 수 있습니다. 포식자는 안쪽 목표를 향해 감속합니다. 맵 축소 시 현재 위치를 유지합니다.',
      hybrid:
        '혼합: Boid에 부드러운 회피를 적용하고, 끝에 닿으면 Hard 제한합니다. Soft에서 전환하면 경계 밖 개체를 즉시 안쪽으로 보정합니다.',
    }[this.settings.boundaryMode];
  }

  syncGoal() {
    const { goal, goalPath, goalSpeed, goalStrength } = this.settings;
    byId('goal-legend').hidden = !goal;
    byId('goal-path-legend').hidden = !(goal && goalPath);
    const motion = !goal
      ? '목표 꺼짐 · 위치 유지'
      : goalSpeed === 0
        ? '고정 목표'
        : `이동 목표 · ${goalSpeed.toFixed(2)}×`;
    byId('goal-motion-state').textContent =
      motion + (goal && goalStrength === 0 ? ' · 추적 힘 0' : '');
  }

  selectObstacle(id) {
    this.selectedObstacleId = id;
    byId('obstacle-settings').open = true;
    this.obstacleFeedback('');
    this.syncObstacles();
  }

  syncObstacles() {
    const items = this.actions.obstacles();
    if (!items.some((item) => item.id === this.selectedObstacleId))
      this.selectedObstacleId = items[0]?.id ?? null;
    const select = byId('selected-obstacle');
    select.replaceChildren(
      ...items.map(
        (item) =>
          new Option(
            `OBS ${String(item.id).padStart(2, '0')} · ${item.type === 'box' ? '박스 / Box' : '구 / Sphere'}`,
            item.id,
          ),
      ),
    );
    if (!items.length) select.add(new Option('장애물이 없습니다', ''));
    select.value = this.selectedObstacleId ?? '';
    select.disabled = !items.length;
    const item = items.find((obstacle) => obstacle.id === this.selectedObstacleId);
    byId('obstacle-fields').disabled = !item;
    byId('remove-obstacle').disabled = !item;
    byId('sphere-size').hidden = item?.type === 'box';
    byId('box-size').hidden = item?.type !== 'box';
    for (const key of ['x', 'y', 'z', 'radius', 'width', 'height', 'depth'])
      byId(`obstacle-${key}`).value = item?.[key] ?? '';
    for (const [axis, halfSize] of ['x', 'y', 'z'].map((axis, index) => [
      axis,
      this.actions.bounds().halfSize[index],
    ])) {
      byId(`obstacle-${axis}`).min = -halfSize;
      byId(`obstacle-${axis}`).max = halfSize;
    }
    for (const type of ['sphere', 'box'])
      byId(`add-${type}`).disabled = items.length >= MAX_OBSTACLES;
    byId('obstacle-count').textContent = `${items.length} / ${MAX_OBSTACLES}`;
    byId('obstacle-disabled').hidden = this.settings.obstacles;
    this.actions.selectObstacle(this.selectedObstacleId);
  }

  obstacleFeedback(message, error = false) {
    byId('obstacle-feedback').textContent = message;
    byId('obstacle-feedback').dataset.error = String(error);
  }

  worldFeedback(message, error = false) {
    byId('world-feedback').textContent = message;
    byId('world-feedback').dataset.error = String(error);
  }

  setPaused(paused) {
    const label = paused ? '재생' : '일시정지';
    byId('play-label').textContent = label;
    byId('play-pause').setAttribute('aria-label', label);
    byId('play-icon').setAttribute('href', paused ? '#icon-play' : '#icon-pause');
    byId('simulation-status').textContent = paused ? 'PAUSED' : 'LIVE SIMULATION';
    byId('live-dot').classList.toggle('paused', paused);
    byId('single-step').disabled = !paused;
  }

  updateInspection(simulation) {
    const info = simulation.inspection;
    byId('inspected-id').textContent = `#${String(info.index + 1).padStart(4, '0')}`;
    byId('inspected-neighbors').textContent = info.neighborCount;
    byId('inspected-close').textContent = info.closeCount;
    byId('inspected-speed').textContent = Math.hypot(...info.velocity).toFixed(1);
    for (const key of ['cohesion', 'alignment', 'separation'])
      byId(`force-${key}`).textContent = Math.hypot(...info[key]).toFixed(2);
    byId('inspected-perception').textContent =
      `${simulation.settings.perception}u · ${simulation.settings.fieldOfView}°`;
    byId('selected-boid').value = info.index + 1;
  }

  updateMetrics(simulation, fps, stepMs) {
    const seconds = Math.floor(simulation.time);
    byId('timecode').textContent =
      `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
    byId('fps').textContent = Math.round(fps);
    byId('step-ms').textContent = stepMs.toFixed(2);
    byId('mean-speed').textContent = simulation.metrics.meanSpeed.toFixed(1);
    const alignment = Math.round(simulation.metrics.alignment * 100);
    byId('order').textContent = `${alignment}%`;
    byId('order-fill').style.width = `${alignment}%`;
    byId('boundary-outside').textContent =
      `영역 밖 Boid ${simulation.metrics.outsideCount} / ${simulation.count} · 최대 이탈 ${simulation.metrics.maxExcursion.toFixed(1)} u`;
  }

  notify(message) {
    clearTimeout(this.toastTimer);
    const toast = byId('toast');
    toast.textContent = message;
    toast.classList.add('visible');
    this.toastTimer = setTimeout(() => toast.classList.remove('visible'), 2400);
  }

  dispose() {
    this.abort.abort();
    clearTimeout(this.toastTimer);
  }
}
