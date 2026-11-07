#pragma once
#include "core/SimulationConstants.h"
#include "core/WorldBounds.h"
#include "simulation/BirdVectorBuffer.h"
#include <array>
#include <vector>

namespace boids
{
	// 직접 주소 격자로 후보 셀과 개체 연결 배열을 소유합니다.
	// 위치를 빌리지 않으며 Soft 경계의 끝 셀은 맵 밖으로 확장합니다.
	// QueryCandidates는 탐색 후보를 기록하며 정확한 거리·시야 필터는 호출자가 적용합니다.
	// 출력 벡터는 먼저 비우며 예약 용량이 부족하면 조회 중 확장할 수 있습니다.
	class FSpatialGrid
	{
	public:
		/**
		 * 월드 크기와 셀 너비로 셀 수를 정하고 활성 개체를 셀별 인덱스 연결 목록에 삽입합니다.
		 * 월드 밖 개체는 끝 셀에 넣으며 원본 위치를 참조로 보관하지 않습니다.
		 * @pre BirdCount는 입력 용량 이하, 크기·셀 너비는 양수·유한 값이며 전체 셀 수는 GridCellCapacity 이하여야 합니다.
		 */
		void Rebuild(const FBirdVectorBuffer& BirdPositions, int BirdCount, const FWorldBounds& Bounds, double NewCellWidth);

		/**
		 * 출력 목록을 비운 뒤 조회 구와 겹칠 수 있는 셀을 골라 해당 셀의 개체 인덱스를 기록합니다.
		 * @param OutCandidateIndices 호출자 소유의 재사용 출력 벡터입니다. 용량이 부족하면 확장될 수 있습니다.
		 * @note Rebuild가 선행되어야 하며 정확한 개체별 거리·시야 검사는 호출자가 수행합니다.
		 * @note 재구축이 없는 동안 서로 다른 출력 벡터를 사용하는 조회는 내부 탐색 상태를 수정하지 않습니다.
		 */
		void QueryCandidates(const FVector3D& QueryPosition, double QueryRadius, std::vector<int>& OutCandidateIndices) const;

	private:
		struct FCellRange
		{
			int First;

			int Last;
		};

		/** 월드 좌표를 셀 좌표로 변환하고 유효 범위로 제한합니다. 월드 밖 좌표는 양 끝 셀로 매핑합니다. */
		int GetCellCoordinate(double Value, EAxis Axis) const;

		/** 유효한 XYZ 셀 좌표를 셀 머리 배열의 일차원 인덱스로 변환합니다. */
		int GetCellIndex(int X, int Y, int Z) const;

		/** 중심 셀에서 CellSearchRadius만큼 확장하되 격자 범위 안으로 제한한 양 끝 포함 셀 구간을 반환합니다. */
		FCellRange GetQueryCellRange(double Value, EAxis Axis, int CellSearchRadius) const;

		/**
		 * 한 축에서 조회점과 셀 구간 사이의 최소 거리 하한을 반환하여 셀 전체 제외에 사용합니다.
		 * @note Soft 경계의 월드 밖 개체를 놓치지 않도록 양 끝 셀은 바깥쪽 무한 구간으로 취급합니다.
		 */
		double GetCellDistanceLowerBound(double Value, int Cell, EAxis Axis) const;

		// 셀 머리와 개체별 다음 인덱스로 셀 내부 연결 목록을 구성합니다(-1은 끝).
		std::array<int, constants::GridCellCapacity> CellHeads{};

		std::array<int, constants::MaxBirdCount> NextBirdIndices{};

		// 마지막 Rebuild에서 확정한 격자 크기와 월드 범위입니다.
		std::array<int, constants::AxisCount> AxisCellCounts{};

		FVector3D WorldHalfExtents;

		double CellWidth = constants::DefaultGridCellSize;
	};
} // namespace boids
