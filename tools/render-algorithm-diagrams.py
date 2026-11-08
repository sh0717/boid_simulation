"""README의 소스 기반 알고리즘 도식을 PNG로 생성합니다.

실행: python tools/render-algorithm-diagrams.py
필수: Pillow, 한국어 글꼴. --font/--bold-font로 글꼴 경로를 지정할 수 있습니다.
"""

import argparse
import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "docs" / "images"
INK = "#16324A"
MUTED = "#536B7E"
BLUE = "#176AA3"
TEAL = "#087F7A"
RED = "#BB4A4A"
BORDER = "#CCDCE7"
BG = "#F5F8FB"
WHITE = "#FFFFFF"


def parse_args():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--font", default="C:/Windows/Fonts/malgun.ttf")
    parser.add_argument("--bold-font", default="C:/Windows/Fonts/malgunbd.ttf")
    return parser.parse_args()


ARGS = parse_args()
FONTS = {}


def font(size, bold=False):
    key = (size, bold)
    if key not in FONTS:
        FONTS[key] = ImageFont.truetype(ARGS.bold_font if bold else ARGS.font, size)
    return FONTS[key]


class Diagram:
    def __init__(self, height, title, subtitle):
        self.image = Image.new("RGB", (1600, height), BG)
        self.draw = ImageDraw.Draw(self.image)
        self.text(64, 34, title, 44, bold=True)
        self.text(66, 100, subtitle, 27, MUTED)

    def text(self, x, y, text, size=28, color=INK, bold=False, max_width=None):
        face = font(size, bold)
        if max_width is not None:
            assert self.draw.textlength(text, font=face) <= max_width, text
        self.draw.text((x, y), text, font=face, fill=color, stroke_width=0)

    def box(self, bounds, fill=WHITE, outline=BORDER, radius=20):
        self.draw.rounded_rectangle(bounds, radius=radius, fill=fill, outline=outline, width=2)

    def arrow(self, start, end, color=BLUE, width=5, head=15):
        self.draw.line((start, end), fill=color, width=width)
        angle = math.atan2(end[1] - start[1], end[0] - start[0])
        points = [end]
        for offset in (-0.5, 0.5):
            points.append((end[0] - head * math.cos(angle + offset), end[1] - head * math.sin(angle + offset)))
        self.draw.polygon(points, fill=color)

    def footer(self, y):
        self.text(66, y, "현재 소스의 순서와 데이터 계약을 그린 알고리즘 도식입니다. 실행 화면 캡처가 아닙니다.", 24, MUTED)

    def save(self, name):
        OUT.mkdir(parents=True, exist_ok=True)
        path = OUT / name
        self.image.save(path, optimize=True)
        print(f"{path.relative_to(ROOT)}: {self.image.width} x {self.image.height}, {path.stat().st_size:,} bytes")


def flow():
    d = Diagram(1600, "한 프레임에서 한 스텝까지", "브라우저 시간 관리 → C++ 군집 계산 → Three.js 화면 갱신")
    d.box((64, 160, 1536, 340), fill="#EAF3FB", outline="#A8C9E3")
    d.text(94, 183, "01  requestAnimationFrame → SimulationClock.advance", 33, BLUE, True)
    d.text(94, 240, "프레임 경과 시간은 0~0.1초로 제한하고 재생 속도(0~2)를 곱합니다.", 28)
    d.text(94, 286, "고정 dt = 1/60초 · 프레임당 최대 12스텝 · 남은 누적 시간으로 보간 계수 α 계산", 28)
    d.arrow((800, 344), (800, 393))
    d.box((64, 400, 1536, 1310), outline="#A5D4D1")
    d.text(94, 420, "02  FSimulation::Step(dt) — 아래 순서로 한 번 실행", 34, TEAL, True)

    rows = [
        ("입력 고정", ["ABI 설정·상태·장애물을 읽고 이전 위치를 저장합니다."]),
        ("시간·actor", ["시간/목표 위상 진행 → 목표 갱신 → 포식자 갱신",
                        "포식자는 이동 전 군집을 읽고, 군집은 갱신된 actor를 읽습니다."]),
        ("공간 탐색", ["현재 위치로 Grid / KdTree를 다시 구축합니다."]),
        ("다음 속도", ["모든 개체: 이웃 → 분리·응집·정렬 → 목표 → 포식자",
                        "→ 장애물 예측 회피 → 경계 조향 → 힘·속력 제한"]),
        ("위치·접촉", ["속도 버퍼 swap → 새 속도로 위치 적분",
                        "→ 장애물 침투 보정·반사 → 월드 경계·속력 보정"]),
        ("출력 발행", ["거리 검사 횟수·이동 후 통계 계산 → ABI 상태에 발행",
                        "위치·속도는 군집 소유 버퍼에 이미 기록되어 있습니다."]),
    ]
    y = 492
    heights = [102, 138, 102, 138, 138, 138]
    for index, ((label, lines), height) in enumerate(zip(rows, heights), 1):
        if index % 2:
            d.box((87, y, 1513, y + height - 8), fill="#F3F9F8", outline="#F3F9F8", radius=10)
        d.text(110, y + 16, f"{index}. {label}", 29, TEAL, True)
        for line_index, line in enumerate(lines):
            d.text(380, y + 14 + line_index * 44, line, 28, max_width=1090)
        y += height
    d.arrow((800, 1315), (800, 1364))
    d.box((64, 1372, 1536, 1504), fill="#EAF3FB", outline="#A8C9E3")
    d.text(94, 1390, "03  Three.js 렌더링", 33, BLUE, True)
    d.text(94, 1446, "이전 위치와 현재 위치를 α로 보간하고 메시·목표·포식자·관찰 표시를 갱신합니다.", 28)
    d.footer(1540)
    d.save("algorithm-flow.png")


def bird(d, point, label, color, heading=0):
    x, y = point
    points = [(x + 17, y), (x - 12, y - 12), (x - 7, y), (x - 12, y + 12)]
    if heading:
        points = [(x + (px - x) * math.cos(heading) - (py - y) * math.sin(heading),
                   y + (px - x) * math.sin(heading) + (py - y) * math.cos(heading)) for px, py in points]
    d.draw.polygon(points, fill=color)
    d.text(x + 20, y - 22, label, 29, color, True)


def neighborhood():
    d = Diagram(1200, "어떤 이웃이 어떤 힘에 반영되는가", "3차원 인지 구의 2차원 단면 · 예시 R = 10, 시야각 = 180°, K = 0(무제한)")
    d.box((64, 165, 845, 820))
    cx, cy, radius = 420, 490, 255
    d.draw.ellipse((cx-radius, cy-radius, cx+radius, cy+radius), fill="#F0F3F6", outline="#95ADC0", width=3)
    d.draw.pieslice((cx-radius, cy-radius, cx+radius, cy+radius), -90, 90, fill="#E1F0FA", outline="#91BEDD", width=2)
    sep = radius * 3.2 / 10
    d.draw.ellipse((cx-sep, cy-sep, cx+sep, cy+sep), fill="#FCE7E4", outline="#D7897F", width=3)
    d.draw.line((cx, cy-radius, cx, cy+radius), fill="#91BEDD", width=2)
    d.text(90, 185, "뒤쪽: 시야 밖", 28, MUTED, True)
    d.text(557, 185, "앞쪽: 시야 안", 28, BLUE, True)
    d.arrow((cx+12, cy+46), (cx+165, cy+46), BLUE)
    d.text(cx+60, cy+62, "진행 방향", 26, BLUE)
    d.text(625, 296, "R = 10", 28, BLUE, True)
    d.text(343, 602, "분리 반경 3.2", 27, RED, True)
    bird(d, (420, 490), "i", INK)
    bird(d, (570, 400), "A", TEAL, -0.25)
    bird(d, (365, 470), "B", RED, 2.5)
    bird(d, (245, 365), "C", MUTED, 1.7)
    bird(d, (740, 655), "D", MUTED, -0.7)
    d.text(96, 765, "실제 판정은 3D 거리 제곱과 속도·방향 내적을 사용합니다.", 24, MUTED)

    notes = [
        ("A  가시 이웃", "인지 반경·시야 안 → 응집·정렬", TEAL, "#E8F6F2"),
        ("B  후방의 근접 이웃", "분리에 포함 → FOV에서 응집·정렬 제외", RED, "#FCEDE9"),
        ("C  시야 밖, 분리 반경 밖", "인지 반경 안이어도 세 힘에 반영 안 됨", MUTED, "#EDF2F6"),
        ("D  인지 반경 밖", "거리 검사에서 제외", MUTED, "#EDF2F6"),
    ]
    y = 165
    for title, detail, color, fill in notes:
        d.box((880, y, 1536, y+142), fill=fill, outline=fill)
        d.text(904, y+20, title, 30, color, True)
        d.text(904, y+77, detail, 26, max_width=608)
        y += 165

    labels = [("1  거리", "자신 제외 · d < R"), ("2  K 선택", "가까운 순 · 동률 ID"),
              ("3  분리", "선택 이웃 중 d < 3.2"), ("4  FOV", "속도 방향·각도 검사"),
              ("5  응집·정렬", "가시 이웃만 합산")]
    x = 64
    for index, (title, detail) in enumerate(labels):
        d.box((x, 874, x+270, 1009), fill="#EAF3FB", outline="#BCD4E6")
        d.text(x+17, 890, title, 29, BLUE, True)
        d.text(x+17, 947, detail, 23, max_width=240)
        if index < len(labels)-1:
            d.arrow((x+273, 940), (x+298, 940), head=10, width=4)
        x += 300
    d.text(67, 1042, "K > 0이면 반경 안에서 먼저 K개를 고릅니다. 뒤쪽 개체도 K를 차지하며 분리 역시 이 선택에 종속됩니다.", 25)
    d.text(67, 1086, "거리 제곱 < 1e-8인 겹침은 개체 ID로 ±X 분리 방향을 정합니다. FOV 검사는 이 경우 생략합니다.", 25)
    d.footer(1144)
    d.save("algorithm-neighborhood.png")


def buffers():
    d = Diagram(1430, "현재 상태를 모두 읽은 뒤 다음 상태를 적용합니다", "속도 더블 버퍼 · 위치 스냅샷 · 적분 완료 후 화면 보간")
    d.box((64, 165, 1536, 627), fill="#EDF6FB", outline="#A8C9E3")
    d.text(93, 188, "01  힘·다음 속도 계산 — 모든 개체가 같은 현재 상태를 읽습니다", 32, BLUE, True)
    d.box((96, 280, 483, 520))
    d.text(121, 303, "현재 상태: 읽기", 29, BLUE, True)
    d.text(121, 361, "Positions = x(t)", 29)
    d.text(121, 411, "Velocities = v(t)", 29)
    d.text(121, 468, "이 단계 동안 변경 안 함", 25, MUTED)
    d.arrow((488, 396), (570, 396))
    d.box((578, 280, 987, 520))
    d.text(603, 303, "i = 0 ... N-1", 30, BLUE, True)
    d.text(603, 361, "군집력 → 외부 힘·경계", 27)
    d.text(603, 411, "힘 제한 → v + a·dt", 27)
    d.text(603, 468, "다음 속력 [5, 12]로 제한", 25, MUTED)
    d.arrow((992, 396), (1074, 396))
    d.box((1082, 280, 1504, 520), fill="#E7F5EF", outline="#A7D6C6")
    d.text(1106, 303, "다음 속도: 쓰기", 29, TEAL, True)
    d.text(1106, 361, "NextVelocities[i]", 29)
    d.text(1106, 411, "v_next[i] 기록", 29)
    d.text(1106, 468, "위치는 아직 적분하지 않음", 25, MUTED)
    d.text(96, 559, "IntegrateNextVelocities는 현재 구현에서 직렬입니다. 앞 개체의 새 속도가 뒤 개체의 이웃 계산에 섞이지 않습니다.", 25)
    d.arrow((800, 631), (800, 687))

    d.box((64, 695, 1536, 1014), fill="#F0F7F3", outline="#A7D6C6")
    d.text(94, 715, "02  전체 다음 속도 계산 완료 → 역할 교체 → 위치 적분·접촉 처리", 32, TEAL, True)
    d.box((96, 789, 595, 922))
    d.text(120, 810, "swap(Velocities, NextVelocities)", 26, TEAL, True, max_width=458)
    d.text(120, 865, "새 속도가 현재 속도 역할을 맡습니다.", 25)
    d.arrow((602, 855), (668, 855), TEAL)
    d.box((676, 789, 1504, 922))
    d.text(699, 807, "x(t+dt) = x(t) + v_next·dt", 29, TEAL, True)
    d.text(699, 865, "각 개체: 위치 적분 → 장애물 보정·반사 → 경계·속력 보정", 25)
    d.text(96, 956, "이 위치·보정 구간은 native에서 분할 실행할 수 있습니다. Wasm은 직렬이며, 모든 작업 완료 후 반환합니다.", 25)
    d.arrow((800, 1018), (800, 1074))

    d.box((64, 1082, 1536, 1328), fill="#EAF3FB", outline="#A8C9E3")
    d.text(94, 1102, "03  Three.js는 위치의 이전·현재 값을 읽어 그립니다", 32, BLUE, True)
    d.text(96, 1162, "PreviousPositions = x(t)                 Positions = 보정된 x(t+dt)", 29)
    d.text(96, 1221, "x_render = (1 - α)·PreviousPositions + α·Positions", 32, BLUE, True)
    d.text(96, 1277, "보간은 화면 표시용입니다. 다음 물리 스텝의 위치·속도에는 되쓰지 않습니다.", 25, MUTED)
    d.footer(1370)
    d.save("algorithm-buffers.png")


if __name__ == "__main__":
    flow()
    neighborhood()
    buffers()
