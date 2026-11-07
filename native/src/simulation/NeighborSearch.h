#pragma once
#include "core/SimulationConfig.h"
#include "simulation/BirdVectorBuffer.h"
#include "simulation/KdTree.h"
#include "simulation/SpatialGrid.h"
#include <vector>

// 구체 격자, 최대 용량을 예약한 후보 벡터와 마지막 탐색 설정을 소유합니다.
// Rebuild 호출 동안만 위치를 읽으며 이후 조회는 내부 공간 인덱스 스냅샷을 사용합니다.
// QueryCandidates 전에 Rebuild하며 설정·개체 수·위치 변경 후에도 다시 Rebuild합니다.
// 반환 벡터 참조의 내용은 이 객체의 다음 Rebuild 또는 QueryCandidates가 바꿀 수 있습니다.
// 탐색 후보만 반환하며 정확한 거리·시야 필터는 호출자가 적용합니다.
class FNeighborSearch
{
public:
	/** Grid·KD-tree 저장소를 준비하고 후보 벡터에 최대 개체 수의 용량을 예약합니다. */
	FNeighborSearch();

	FNeighborSearch(const FNeighborSearch&) = delete;

	FNeighborSearch& operator=(const FNeighborSearch&) = delete;

	FNeighborSearch(FNeighborSearch&&) = delete;

	FNeighborSearch& operator=(FNeighborSearch&&) = delete;

	/**
	 * 선택한 방식으로 현재 활성 개체를 인덱싱하고 다음 후보 조회에 사용할 탐색 방식을 저장합니다.
	 * AllPairs는 활성 개체 전체 목록을 만들며 Grid·KD-tree는 위치 기반 내부 스냅샷을 재구축합니다.
	 * @pre BirdCount는 입력 위치 용량 안의 개수이며 Grid 설정은 유효한 셀 수·양수 크기를 만족해야 합니다.
	 * @note 위치는 이 호출에서만 읽습니다. 원본 위치·활성 수·설정 변경 후에는 다시 구축해야 합니다.
	 */
	void Rebuild(ESearchMethod Method, const FBirdVectorBuffer& BirdPositions, int BirdCount, const FWorldBounds& Bounds, double CellWidth);

	/**
	 * 마지막 Rebuild의 탐색 방식으로 조회 위치·반경에 대한 후보 개체 인덱스를 반환합니다.
	 * @return 이 객체 소유 후보 벡터의 참조이며 정확한 거리·시야 필터를 통과한 이웃 목록은 아닙니다.
	 * @note 다음 조회·재구축이 내용을 바꿀 수 있으므로 참조를 보관한 채 다른 조회를 수행하지 않습니다.
	 * @note 공통 후보 버퍼를 재사용하므로 같은 객체의 조회와 재구축을 동시에 호출하지 않습니다.
	 */
	[[nodiscard]] const std::vector<int>& QueryCandidates(const FVector3D& QueryPosition, double QueryRadius);

private:
	// 공간 인덱스는 위치를 빌리지 않고 Rebuild 시점의 정보를 소유합니다.
	FSpatialGrid Grid;

	FKdTree KdTree;

	// 조회마다 재사용하는 후보 저장소이며 외부에는 참조만 빌려줍니다.
	std::vector<int> CandidateIndices;

	ESearchMethod SearchMethod = ESearchMethod::Grid;
};
