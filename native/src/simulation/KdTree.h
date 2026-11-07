#pragma once
#include "core/Axis.h"
#include "core/SimulationConstants.h"
#include "core/Vector3D.h"
#include "simulation/BirdVectorBuffer.h"
#include <array>
#include <vector>

namespace boids
{
	// 균형 중앙값 kd-tree의 분할 및 인덱스 배열을 소유합니다.
	// 위치는 Rebuild 호출 동안만 읽으며 이후 조회는 소유한 인덱스·분할 좌표를 사용합니다.
	// 원본 위치 변경 후 새 위치를 검색하려면 Rebuild해야 합니다.
	// QueryCandidates는 탐색 후보를 기록하며 정확한 거리·시야 필터는 호출자가 적용합니다.
	// 출력 벡터는 먼저 비우며 예약 용량이 부족하면 조회 중 확장할 수 있습니다.
	class FKdTree
	{
	public:
		/**
		 * 활성 개체의 인덱스를 축별 중앙값으로 분할하고 각 노드의 개체·분할 축·분할 좌표·자식을 저장합니다.
		 * @pre BirdCount는 [0, BirdPositions.GetBirdCapacity()] 범위여야 합니다.
		 * @note 0개이면 루트는 -1입니다. 원본 위치는 구축 중에만 읽으며 위치 변경 후 다시 구축해야 합니다.
		 */
		void Rebuild(const FBirdVectorBuffer& BirdPositions, int BirdCount);

		/**
		 * 출력 벡터를 비운 뒤 분할 평면과 조회 반경을 비교하여 방문 가능한 가지의 개체를 기록합니다.
		 * @param OutCandidateIndices 호출자 소유 후보 저장소입니다. 필요한 용량이 없으면 확장될 수 있습니다.
		 * @note 실제 구 거리와 시야를 검사하지 않습니다. 동일 노드 데이터에 대한 읽기와 호출별 지역 순회 스택만 사용합니다.
		 */
		void QueryCandidates(const FVector3D& QueryPosition, double QueryRadius, std::vector<int>& OutCandidateIndices) const;

	private:
		// 분할 후 중앙값 선택을 계속할 왼쪽·오른쪽 구간의 경계입니다.
		struct FPartition
		{
			int LeftLastNodeIndex;

			int RightFirstNodeIndex;
		};

		/**
		 * 개체 두 개의 지정 축 좌표를 비교하고 같으면 개체 인덱스로 순서를 결정합니다.
		 * @note 좌표 동률에서도 동일한 분할·후보 순서를 재현하기 위한 비교 기준입니다.
		 */
		static bool IsBirdBeforeOnAxis(const FBirdVectorBuffer& Positions, int LhsBirdIndex, int RhsBirdIndex, EAxis Axis);

		/**
		 * 중간 인덱스의 개체를 피벗으로 삼아 양 끝 포함 구간의 개체 인덱스를 좌우로 분할합니다.
		 * @return 중앙값 선택을 이어갈 왼쪽 구간의 끝과 오른쪽 구간의 시작입니다. BirdIndices를 수정합니다.
		 */
		FPartition PartitionIndices(const FBirdVectorBuffer& Positions, int FirstNodeIndex, int LastNodeIndex, EAxis Axis);

		/**
		 * 전체 구간을 정렬하지 않고 분할을 반복하여 MedianNodeIndex의 개체를 확정합니다.
		 * @note FirstNodeIndex·LastNodeIndex를 모두 포함하며 결과 양쪽 구간 내부의 정렬은 보장하지 않습니다.
		 */
		void SelectMedian(const FBirdVectorBuffer& Positions, int FirstNodeIndex, int LastNodeIndex, int MedianNodeIndex, EAxis Axis);

		/**
		 * 깊이에 따라 X → Y → Z 축을 순환하고 중앙값 노드에서 좌우 구간을 재귀 구축합니다.
		 * @return 이 구간의 루트 노드 인덱스이며 빈 구간은 -1입니다. 각 노드의 분할 좌표를 스냅샷으로 저장합니다.
		 */
		int BuildBranch(const FBirdVectorBuffer& Positions, int FirstNodeIndex, int LastNodeIndex, int Depth);

		// 노드 인덱스를 기준으로 개체·자식·분할 스냅샷을 함께 조회합니다.
		std::array<int, constants::MaxBirdCount> BirdIndices{};

		std::array<int, constants::MaxBirdCount> LeftChildNodes{};

		std::array<int, constants::MaxBirdCount> RightChildNodes{};

		std::array<EAxis, constants::MaxBirdCount> SplitAxes{};

		std::array<float, constants::MaxBirdCount> SplitCoordinates{};

		// 활성 개체가 없으면 -1입니다.
		int RootNode = -1;
	};
} // namespace boids
