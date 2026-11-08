#pragma once

// C++ 코어는 예외를 통한 복구를 제공하지 않습니다. 빌드 설정이 이 계약과 다르면 컴파일을 중단합니다.
#if defined(__cpp_exceptions) || defined(__EXCEPTIONS) || defined(_CPPUNWIND)
#error "Boids C++ targets must disable C++ exceptions."
#endif

#if defined(_MSC_VER) && (!defined(_HAS_EXCEPTIONS) || _HAS_EXCEPTIONS != 0)
#error "Boids MSVC targets must define _HAS_EXCEPTIONS=0."
#endif
