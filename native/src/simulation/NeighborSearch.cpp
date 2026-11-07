#include "simulation/NeighborSearch.h"
#include <cassert>
#include <numeric>

FNeighborSearch::FNeighborSearch()
{
	CandidateIndices.reserve(constants::MaxBirdCount);
}

void FNeighborSearch::Rebuild(ESearchMethod Method, const FBirdVectorBuffer& BirdPositions, int BirdCount, const FWorldBounds& Bounds, double CellWidth)
{
	assert(BirdCount >= 0 && BirdCount <= constants::MaxBirdCount);
	assert(BirdPositions.GetBirdCapacity() >= BirdCount);
	SearchMethod = Method;
	// 전수 탐색은 위치 인덱스 대신 활성 개체 전체 목록을 후보로 재사용합니다.
	if (Method == ESearchMethod::AllPairs)
	{
		CandidateIndices.resize(static_cast<std::size_t>(BirdCount));
		std::iota(CandidateIndices.begin(), CandidateIndices.end(), 0);
		return;
	}
	if (Method == ESearchMethod::KdTree)
	{
		KdTree.Rebuild(BirdPositions, BirdCount);
	}
	else
	{
		Grid.Rebuild(BirdPositions, BirdCount, Bounds, CellWidth);
	}
}

const std::vector<int>& FNeighborSearch::QueryCandidates(const FVector3D& QueryPosition, double QueryRadius)
{
	if (SearchMethod == ESearchMethod::AllPairs)
	{
		return CandidateIndices;
	}
	if (SearchMethod == ESearchMethod::KdTree)
	{
		KdTree.QueryCandidates(QueryPosition, QueryRadius, CandidateIndices);
	}
	else
	{
		Grid.QueryCandidates(QueryPosition, QueryRadius, CandidateIndices);
	}
	return CandidateIndices;
}
