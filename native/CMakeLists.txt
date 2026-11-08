# Remove CMake's MSVC default in this directory before applying the target policy.
if(MSVC)
  string(REGEX REPLACE "(^|[ \t])[-/]EHsc([ \t]|$)" "\\1" CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS}")
endif()

file(STRINGS "${CMAKE_CURRENT_SOURCE_DIR}/sources.txt" boids_sources)
set_property(DIRECTORY APPEND PROPERTY CMAKE_CONFIGURE_DEPENDS sources.txt)
list(TRANSFORM boids_sources PREPEND "${PROJECT_SOURCE_DIR}/")
add_library(boids_core STATIC ${boids_sources})

# Keep the core and every native consumer on the same no-exceptions STL contract.
if(MSVC)
  target_compile_options(boids_core PUBLIC /EHs-c-)
  target_compile_definitions(boids_core PUBLIC _HAS_EXCEPTIONS=0)
else()
  target_compile_options(boids_core PUBLIC -fno-exceptions)
endif()

target_include_directories(boids_core PUBLIC "${CMAKE_CURRENT_SOURCE_DIR}/bindings/include")
target_include_directories(boids_core PRIVATE
  "${CMAKE_CURRENT_SOURCE_DIR}/src"
  "${CMAKE_CURRENT_SOURCE_DIR}/bindings")

set_target_properties(boids_core PROPERTIES ARCHIVE_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}")

option(BOIDS_ENABLE_THREADS "Parallelize independent native bird updates with std::thread" ON)
if(BOIDS_ENABLE_THREADS AND NOT EMSCRIPTEN)
  find_package(Threads REQUIRED)
  target_link_libraries(boids_core PRIVATE Threads::Threads)
  target_compile_definitions(boids_core PUBLIC BOIDS_ENABLE_THREADS=1)
endif()

set(boids_targets boids_core)

option(BOIDS_BUILD_DEBUG_RUNNER "Build the native C++ debug scenario" ON)
if(BOIDS_BUILD_DEBUG_RUNNER AND NOT EMSCRIPTEN)
  add_executable(boids_debug "${PROJECT_SOURCE_DIR}/tests/native/DebugRunner.cpp")
  set_target_properties(boids_debug PROPERTIES RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}")
  target_link_libraries(boids_debug PRIVATE boids_core)
  list(APPEND boids_targets boids_debug)
endif()

if(BUILD_TESTING AND NOT EMSCRIPTEN)
  add_executable(boids_core_tests ../tests/native/core-tests.cpp)
  target_link_libraries(boids_core_tests PRIVATE boids_core)
  target_include_directories(boids_core_tests PRIVATE
    "${CMAKE_CURRENT_SOURCE_DIR}/src"
    "${CMAKE_CURRENT_SOURCE_DIR}/bindings")
  list(APPEND boids_targets boids_core_tests)
  add_test(NAME native-core-contracts COMMAND boids_core_tests)

  if(BOIDS_ENABLE_THREADS)
    add_executable(boids_parallel_tests ../tests/native/parallel-tests.cpp)
    target_link_libraries(boids_parallel_tests PRIVATE boids_core Threads::Threads)
    target_include_directories(boids_parallel_tests PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}/src")
    list(APPEND boids_targets boids_parallel_tests)
    add_test(NAME native-parallel-bird-updates COMMAND boids_parallel_tests)
    set_tests_properties(native-parallel-bird-updates PROPERTIES TIMEOUT 60)
  endif()
endif()

foreach(target IN LISTS boids_targets)
  set_target_properties(${target} PROPERTIES CXX_STANDARD 20 CXX_STANDARD_REQUIRED YES CXX_EXTENSIONS NO)
  if(MSVC)
    target_compile_options(${target} PRIVATE /W4 /WX /permissive- /fp:strict /utf-8)
  else()
    target_compile_options(${target} PRIVATE -Wall -Wextra -Werror -ffp-contract=off)
  endif()
endforeach()
