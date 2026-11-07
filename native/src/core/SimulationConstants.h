#pragma once
#include <boids/boids.h>

namespace boids::constants
{
	// 고정 용량과 ABI 버퍼 배치
	constexpr int MaxBirdCount = boids::Capacity;
	constexpr int AxisCount = 3;
	constexpr int BirdVectorComponentCount = MaxBirdCount * AxisCount;
	constexpr int ObstacleStride = 8;
	constexpr int InspectionValueCount = 11;
	constexpr int InspectionNeighborCount = 0;
	constexpr int InspectionCloseCount = 1;
	constexpr int InspectionCohesionOffset = 2;
	constexpr int InspectionAlignmentOffset = 5;
	constexpr int InspectionSeparationOffset = 8;

	// 탐색 구조의 용량과 기본 설정
	constexpr int GridCellCapacity = 8000;
	constexpr int DefaultGridCellSize = 10;
	constexpr int KdTraversalStackCapacity = 32;

	// 장애물 레코드의 슬롯과 형상 번호
	constexpr int ObstacleTypeOffset = 0;
	constexpr int ObstaclePositionOffset = 1;
	constexpr int ObstacleRadiusOffset = 4;
	constexpr int ObstacleDimensionsOffset = 5;
	constexpr int SphereObstacleType = 0;
	constexpr int BoxObstacleType = 1;

	// 군집 규칙과 이동 한계
	constexpr int FullFieldOfViewDegrees = 360;
	constexpr int MinimumBoidSpeed = 5;
	constexpr int MaximumBoidSpeed = 12;
	constexpr int MaximumBoidForce = 16;
	constexpr int BoidSpawnPadding = 6;
	constexpr int SeparationScale = 13;

	// 네이티브의 독립 개체 갱신은 기본 병렬 실행하며 호출 스레드 외에 최대 3개 워커를 사용합니다.
	constexpr int MaximumBirdWorkerCount = 3;

	// 목표 경로와 포식자의 정수 상수
	constexpr int GoalHorizontalRadius = 17;
	constexpr int GoalVerticalAmplitude = 12;
	constexpr int GoalVerticalOffset = 3;
	constexpr int GoalReferenceHalfExtent = 25;
	constexpr int PredatorSpawnReferenceSpeed = 5;
	constexpr int PredatorInitialVelocityX = 4;
	constexpr int PredatorInitialVelocityZ = -3;
	constexpr int PredatorCenterInset = 1;
	constexpr int PredatorPursuitGain = 4;
	constexpr int PredatorMaximumAcceleration = 24;
	constexpr int PredatorAvoidanceScale = 65;

	// 장애물 회피 범위와 강도
	constexpr int ObstacleAvoidanceDistance = 4;
	constexpr int ObstacleAvoidanceForceScale = 55;

	// 군집 인지와 힘 가중치
	constexpr double SeparationRadius = 3.2;
	constexpr double CohesionScale = 0.6;
	constexpr double FieldOfViewTolerance = 1e-10;

	// 목표 경로의 각속도·주기와 인력
	constexpr double GoalHorizontalAngularSpeed = 0.18;
	constexpr double GoalVerticalAngularSpeed = 0.27;
	constexpr double GoalAttractionScale = 0.28;
	constexpr double GoalPeriodFrequency = 0.09;

	// 포식자 생성 위치와 근접 회피의 최소 거리
	constexpr double PredatorSpawnXRatio = -0.72;
	constexpr double PredatorSpawnYRatio = 0.32;
	constexpr double PredatorSpawnZRatio = 0.6;
	constexpr double PredatorMinimumAvoidanceDistance = 0.1;

	// 경계 조향과 장애물 접촉 보정
	constexpr double BoundaryMarginFraction = 0.5;
	constexpr double BoundaryForceScale = 3.5;
	constexpr double BoundaryHeadOnCosine = 0.8;
	constexpr double BoundaryTurnRange = 0.2;
	constexpr double ObstacleClearance = 0.65;
	constexpr double ObstacleProjectionSlop = 1e-5;
	constexpr double ObstacleNormalResponseScale = 1.5;
	constexpr double ObstacleLookAhead = 0.45;

	// uint32 난수를 [0, 1)로 변환하는 배율
	constexpr double RandomOutputScale = 4294967296.0;
} // namespace boids::constants
