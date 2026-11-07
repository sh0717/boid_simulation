import { chromium } from 'playwright';

export function launchBrowser() {
  return chromium.launch({
    channel: 'chrome',
    headless: true,
    // CI에서는 호스트 GPU 드라이버 대신 SwiftShader로 로컬 테스트 화면을 렌더링합니다.
    args: process.env.CI === 'true' ? ['--use-gl=angle', '--use-angle=swiftshader'] : [],
  });
}
