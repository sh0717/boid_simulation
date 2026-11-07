# Unreal Engine 소스 기반 C++ 코딩 표준

2026-11-04부터 Boids·PBD·SPH의 현재 C++ 코드에 적용합니다. 기준은
[Epic C++ Coding Standard](https://dev.epicgames.com/documentation/en-us/unreal-engine/epic-cplusplus-coding-standard-for-unreal-engine)와
로컬 UE **5.8.4**, changelist **58902052** 소스입니다.
기존 class C·공백 2칸 규칙은 이 문서로 대체합니다. 과거 감사·성능·이관 문서는 당시 기록으로 보존합니다.

## 1. 참조한 엔진 소스

확인한 엔진 루트는 `C:/Program Files/Epic Games/UE_5.8/Engine`입니다.
아래 경로는 해당 루트 기준이며 프로젝트를 빌드할 때 엔진 설치를 요구하지 않습니다.

| 소스 경로·기호 | 확인한 규칙 |
| --- | --- |
| `Build/Build.version` | 5.8.4와 changelist 확인 |
| `Source/Runtime/Core/Public/Math/RandomStream.h` · `FRandomStream` | F 일반 타입, PascalCase, public 인터페이스, 탭·Allman |
| `Source/Runtime/Core/Public/Misc/FeedbackContext.h` · `FFeedbackContext` | 일반 class도 F, 접근제어자 배치 |
| `Source/Runtime/Core/Public/Misc/ScopeExit.h` · `TScopeGuard` | T 클래스 템플릿, 명시적 소유·복사 제한, namespace 들여쓰기 |
| `Source/Runtime/Core/Public/Templates/UniquePtr.h` · `TDefaultDelete` | T struct 템플릿과 소유권 설명 |
| `Source/Runtime/CorePreciseFP/.clang-format` | 탭 폭 4, Allman 계열, 왼쪽 포인터 정렬, 생성자 쉼표 배치 참고 |

엔진 하위 모듈에는 서로 다른 formatter 설정과 오래된 코드가 공존합니다. 특정 파일을
완전 복제하지 않고 공식 규칙을 우선하며 아래의 프로젝트 선택을 명시합니다.
Epic 저작권 문구나 엔진 구현 코드를 프로젝트 소유 코드에 복사하지 않습니다.

## 2. 타입·함수·변수 명명

| 대상 | 규칙 | 예 |
| --- | --- | --- |
| 일반 class·struct | F 접두사 | `FSimulation`, `FContact` |
| class·struct 템플릿 | T 접두사 | `TOwnerRegistry<ObjectTypes...>` |
| enum class | E 접두사 | `EBoundaryMode` |
| 함수·멤버·인자·지역 변수·일반 상수 | PascalCase | `AdvanceTime`, `ParticleCount`, `MaxParticles` |
| bool 변수·멤버·인자 | b 접두사 | `bEnabled`, `bHasContact` |
| 출력·입출력 인자 | Out·InOut으로 역할 표시 | `OutContacts`, `InOutPosition` |
| 템플릿 타입 인자 | 의미 있는 이름과 Type/Types 접미사를 권장 | `ObjectType`, `CallableType`, `ObjectTypes` |
| 파일 | 타입 접두사를 뺀 PascalCase `.h/.cpp` | `Simulation.h`, `Simulation.cpp` |

함수는 수행 동작이나 반환 의미를 드러냅니다. bool 반환 함수는 `Is`·`Has`·`Can` 등
호출 지점에서 의미가 읽히는 이름을 우선합니다. 클래스라는 이유만으로 C를 붙이지 않습니다.
비템플릿 별칭은 대상 타입의 성격을 따르고 의존 타입 별칭은 의미 있는 `Type` 이름을 사용합니다.
짧고 의미가 명확한 템플릿의 기존 `T` 인자는 허용합니다. 엔진의 `TDefaultDelete<T>`도
같은 예이며 Type 접미사는 모든 템플릿 인자를 일괄 개명하라는 요구가 아닙니다.

## 3. 서식과 파일 구성

- UTF-8/LF, Allman 중괄호, 탭 폭 4를 사용합니다. 들여쓰기와 continuation은 탭 1개입니다.
  탭 뒤의 세부 정렬에 필요한 공백은 허용합니다. 포인터·참조는 `FBody*`, `const FBody&`로 붙입니다.
- 공개 인터페이스를 먼저 읽을 수 있게 public을 앞에 두고 구현 상세는 private에 둡니다.
  접근제어자는 class와 같은 깊이, 멤버는 탭 1개 깊이에 둡니다. 필요한 선행 타입 선언은 허용합니다.
- 지역 선택으로 namespace도 들여씁니다. 함수 선언·정의·호출 인자와 변수 선언·대입·계산·조건식은
  한 줄에 둡니다. 긴 문장을 열 제한 때문에 나누지 않도록 `ColumnLimit: 0`을 사용합니다.
  함수·제어문·람다의 중괄호는 Allman 배치를 유지합니다. 함수 사이와 헤더의 각 멤버 함수·멤버 변수
  사이에는 빈 줄 하나를 유지합니다.
  이 배치는 Epic 전체의 강제 규칙이 아닌 이 프로젝트의 선택입니다.
- 헤더에는 `#pragma once`를 사용합니다. 구현 파일은 대응 헤더를 먼저 포함하고 실제 필요한
  헤더를 직접 포함합니다. 대응 헤더가 없는 binding·entrypoint·test는 역할에 맞게 구성합니다.
- 변수 선언 하나에 이름 하나를 쓰고 긴 식은 역할이 드러나는 지역 변수로 설명합니다.
  무의미한 getter·상속·가상함수·manager를 추가하지 않습니다.
- 주석은 책임, 단위, 범위, 소유권·대여 수명과 실패 계약을 설명합니다.
  기술 설명과 주석의 한글 사용은 이 프로젝트의 명시적 선택입니다.

## 4. 타입·수명·API 계약

- 명시적 타입을 기본으로 합니다. auto는 이름으로 표현할 수 없는 람다,
  가독성을 해치는 긴 iterator 타입, 의존 템플릿 식에 한정합니다.
  타입이 이미 보이는 `make_unique` 결과나 일반 값·참조도 여기서는 명시합니다.
- 읽기 전용 접근은 const 메서드와 const 참조를 사용합니다. 값 반환에 최상위 const를 붙이지 않습니다.
  이동할 값·변경될 값에 관성적으로 const를 붙이지 않습니다.
- 내부 가변 상태는 private으로 소유하고 명령과 조회를 분리합니다. 값 DTO는 공개 필드를 허용합니다.
- 단독 소유는 `std::unique_ptr`, 값 저장은 STL 컨테이너와 RAII를 사용합니다.
  raw pointer는 명시된 비소유·ABI 대여에 한정합니다. 종료·재할당·메모리 성장에 따른
  무효화 조건을 API에 남깁니다.
- `nullptr`, `override`, scoped enum과 `static_assert`를 사용합니다.
  숫자 폭이 중요한 경계는 기존 표준 고정폭 정수와 레이아웃을 유지합니다.
- 람다는 `[&]`, `[=]` 대신 필요한 변수와 `this`를 명시적으로 캡처합니다. 캡처의
  참조 수명과 지연 실행 여부를 검토합니다. 표준 수학 상수가 필요하면 C++20의
  `std::numbers`를 사용하며, 애플리케이션 허용 오차는 기계 엡실론과 구별합니다.

## 5. 독립 C++/Wasm 프로젝트의 적용 경계

이 프로젝트는 Unreal 모듈이 아닙니다. 엔진의 명명·서식·인터페이스 구성 규칙을
채택하되 C++20, STL, `std::` 타입을 사용합니다. Boids의 주요 타입은 전역에 선언합니다.
엔진 의존성, UHT·리플렉션 매크로, `UObject`, `TArray`, `FString`, UE 정수 별칭은 추가하지 않습니다.
매크로는 기존 프로젝트·외부 라이브러리 이름을 유지하며 UE 매크로인 것처럼 이름 붙이지 않습니다.

- Boids 공개 C 헤더의 enum `Config`·`State`, 상수·함수·인자명과 ABI 슬롯은 호환 예외입니다.
- Emscripten 등록 문자열, JS API·JSON 키, WASM export, enum 수치와 버퍼 레이아웃은 유지합니다.
- 표준 라이브러리 프로토콜 `value`, `type`, `operator()` 등 요구되는 이름은 유지합니다.
- entrypoint `main.cpp`, 기존 native test 파일명, 외부 ABI 헤더명은 유지합니다.
- 생성 Wasm·번들, third-party, fixture, 과거 baseline·감사 문서는 일괄 치환하지 않습니다.
  생성물은 기존 빌드 명령으로만 갱신합니다. JS·Python의 언어별 서식도 유지합니다.

## 6. 적용·검사

`.clang-format`, `.editorconfig`의 C++ 섹션, VS Code `[cpp]` 설정을 함께 관리합니다.
`npm run format`으로 적용하고 `npm run check:format`으로 검사합니다.
`npm run check:structure`는 `tools/check-cpp-standard.mjs`를 통해 C++ 타입·bool의
기본 이름 규칙도 검사합니다. 이 검사는 어휘 기반의 빠른 검사이며 완전한 C++ 의미 분석은 아닙니다.
auto 예외의 적절성, const·소유권·책임 경계는 코드 리뷰에서 확인합니다.

C++을 변경하면 `npm run verify`로 Wasm 재생성, Node 회귀, native Debug/Release,
브라우저를 검사합니다. 명명 변경도 외부 문자열·ABI 토큰과 계산 순서를 별도로 대조합니다.
이전 품질 점수·리뷰 지문은 현재 소스 검증으로 자동 승계하지 않습니다.
