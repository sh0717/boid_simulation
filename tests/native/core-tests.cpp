#include "Simulation.h"
#include "SimulationAbi.h"
#include "collision/BoxObstacle.h"
#include "collision/ObstacleSet.h"
#include "collision/SphereObstacle.h"
#include "core/Vector3D.h"
#include "simulation/BirdFlock.h"
#include "simulation/BirdVectorBuffer.h"
#include "simulation/KdTree.h"
#include "simulation/NeighborSearch.h"
#include "simulation/SimulationState.h"
#include "simulation/SpatialGrid.h"
#include <algorithm>
#include <array>
#include <cmath>
#include <cstring>
#include <iostream>
#include <type_traits>
#include <utility>
#include <vector>

namespace
{
	template <typename T, typename = void>
	struct TAcceptsIntegerAxis : std::false_type
	{
	};

	template <typename T>
	struct TAcceptsIntegerAxis<T, std::void_t<decltype(std::declval<T&>()[0])>> : std::true_type
	{
	};

	template <typename TSearch>
	bool MatchesOracle(TSearch& Search, const boids::FBirdVectorBuffer& Positions, int Count)
	{
		std::vector<int> Candidates;
		Candidates.reserve(boids::constants::MaxBirdCount);
		for (const int Index : {0, 17, 31, 63})
		{
			for (const double Radius : {4.0, 10.0, 16.0})
			{
				const int PositionOffset = Index * 3;
				Search.QueryCandidates(boids::FVector3D::Load(Positions.GetAbiData() + PositionOffset), Radius, Candidates);
				const int Found = static_cast<int>(Candidates.size());
				std::array<bool, boids::constants::MaxBirdCount> bSeen{};
				auto IsWithin = [&](int OtherIndex)
				{
					double DistanceSq = 0;
					for (int Axis = 0; Axis < 3; ++Axis)
					{
						const double Delta = static_cast<double>(Positions.GetAbiData()[PositionOffset + Axis]) - Positions.GetAbiData()[OtherIndex * 3 + Axis];
						DistanceSq += Delta * Delta;
					}
					return DistanceSq < Radius * Radius;
				};
				if (Found < 0 || Found > Count)
				{
					return false;
				}
				for (int CandidateOffset = 0; CandidateOffset < Found; ++CandidateOffset)
				{
					const int Candidate = Candidates[CandidateOffset];
					if (Candidate < 0 || Candidate >= Count || bSeen[Candidate])
					{
						return false;
					}
					bSeen[Candidate] = true;
				}
				for (int OtherIndex = 0; OtherIndex < Count; ++OtherIndex)
				{
					if (IsWithin(OtherIndex) && !bSeen[OtherIndex])
					{
						return false;
					}
				}
			}
		}
		return true;
	}

	bool SearchOracles()
	{
		static_assert(!std::is_invocable_v<decltype(&boids::FKdTree::Rebuild), boids::FKdTree&, const float*, int>);
		boids::FBirdVectorBuffer Positions;
		for (int Index = 0; Index < 64; ++Index)
		{
			Positions.GetAbiData()[Index * 3] = static_cast<float>((Index % 8) * 8 - 28);
			Positions.GetAbiData()[Index * 3 + 1] = static_cast<float>((Index / 8) * 8 - 28);
			Positions.GetAbiData()[Index * 3 + 2] = static_cast<float>((Index % 3) * 10 - 10);
		}
		Positions.GetAbiData()[0] = Positions.GetAbiData()[3] = 200;
		Positions.GetAbiData()[1] = Positions.GetAbiData()[4] = 0;
		Positions.GetAbiData()[2] = Positions.GetAbiData()[5] = 0;
		const boids::FWorldBounds HalfSize = {{25, 25, 25}};
		boids::FSpatialGrid Grid;
		boids::FKdTree Tree;
		Grid.Rebuild(Positions, 64, HalfSize, 10);
		Tree.Rebuild(Positions, 64);
		return MatchesOracle(Grid, Positions, 64) && MatchesOracle(Tree, Positions, 64);
	}

	bool NeighborSearchOrderAndLifetime()
	{
		static_assert(!std::is_copy_constructible_v<boids::FNeighborSearch>);
		static_assert(!std::is_move_constructible_v<boids::FNeighborSearch>);
		static_assert(!std::is_copy_assignable_v<boids::FNeighborSearch>);
		static_assert(!std::is_move_assignable_v<boids::FNeighborSearch>);
		const boids::FBirdVectorBuffer Positions;
		const boids::FWorldBounds Bounds = {{25, 25, 25}};
		// 변경 전 WASM의 동일 좌표 9개 inspection에서 자기 자신을 제외한 두 조회로 확인했습니다.
		const int Expected[3][9] = {{8, 7, 6, 5, 4, 3, 2, 1, 0}, {4, 6, 7, 8, 5, 1, 2, 3, 0}, {0, 1, 2, 3, 4, 5, 6, 7, 8}};
		boids::FNeighborSearch Search;
		const int* Borrowed = nullptr;
		for (const int Kind : {0, 1, 2, 0, 2})
		{
			Search.Rebuild(static_cast<boids::ESearchMethod>(Kind), Positions, 9, Bounds, 10);
			const std::vector<int>& View = Search.QueryCandidates({0, 0, 0}, 1);
			if (static_cast<int>(View.size()) != 9 || !std::equal(View.data(), View.data() + 9, Expected[Kind]))
			{
				return false;
			}
			if (Borrowed != nullptr && View.data() != Borrowed)
			{
				return false;
			}
			Borrowed = View.data();
			const std::vector<int>& Repeated = Search.QueryCandidates({0, 0, 0}, 1);
			if (Repeated.data() != Borrowed || static_cast<int>(Repeated.size()) != 9 || !std::equal(Repeated.data(), Repeated.data() + 9, Expected[Kind]))
			{
				return false;
			}
		}
		// 뷰 주소는 유지되지만 다음 Rebuild 또는 Query가 동일 scratch를 덮어쓸 수 있습니다.
		for (const int Count : {3, 9, 1, 9})
		{
			Search.Rebuild(boids::ESearchMethod::Grid, Positions, Count, Bounds, 10);
			const std::vector<int>& GridView = Search.QueryCandidates({0, 0, 0}, 1);
			if (GridView.data() != Borrowed || static_cast<int>(GridView.size()) != Count || !std::equal(GridView.data(), GridView.data() + Count, Expected[0] + 9 - Count))
			{
				return false;
			}
			Search.Rebuild(boids::ESearchMethod::AllPairs, Positions, Count, Bounds, 10);
			const std::vector<int>& AllPairsView = Search.QueryCandidates({0, 0, 0}, 1);
			const std::vector<int>& Repeated = Search.QueryCandidates({0, 0, 0}, 1);
			if (AllPairsView.data() != Borrowed || static_cast<int>(AllPairsView.size()) != Count || Repeated.data() != Borrowed || static_cast<int>(Repeated.size()) != Count || !std::equal(Borrowed, Borrowed + Count, Expected[2]))
			{
				return false;
			}
		}
		// 다른 인스턴스의 재구축과 조회는 앞 객체의 빌린 후보를 바꾸지 않습니다.
		boids::FNeighborSearch OtherSearch;
		OtherSearch.Rebuild(boids::ESearchMethod::Grid, Positions, 9, Bounds, 10);
		const std::vector<int>& OtherView = OtherSearch.QueryCandidates({0, 0, 0}, 1);
		const int* OtherBorrowed = OtherView.data();
		if (OtherView.data() == Borrowed || static_cast<int>(OtherView.size()) != 9 || !std::equal(OtherView.data(), OtherView.data() + 9, Expected[0]) || !std::equal(Borrowed, Borrowed + 9, Expected[2]))
		{
			return false;
		}
		OtherSearch.Rebuild(boids::ESearchMethod::AllPairs, Positions, 3, Bounds, 10);
		const std::vector<int>& OtherSmaller = OtherSearch.QueryCandidates({0, 0, 0}, 1);
		return OtherSmaller.data() == OtherBorrowed && static_cast<int>(OtherSmaller.size()) == 3 && std::equal(OtherSmaller.data(), OtherSmaller.data() + 3, Expected[2]) && std::equal(Borrowed, Borrowed + 9, Expected[2]);
	}

	bool NeighborSearchCapacityOracle()
	{
		boids::FBirdVectorBuffer Positions;
		for (int Index = 0; Index < boids::constants::MaxBirdCount; ++Index)
		{
			Positions.GetAbiData()[Index * 3] = static_cast<float>((Index % 12) * 4 - 22);
			Positions.GetAbiData()[Index * 3 + 1] = static_cast<float>((Index / 12 % 10) * 5 - 22);
			Positions.GetAbiData()[Index * 3 + 2] = static_cast<float>((Index / 120) * 5 - 22);
		}
		// 끝 셀 밖 좌표와 동일 좌표도 독립 거리 oracle에 포함합니다.
		Positions.GetAbiData()[0] = Positions.GetAbiData()[3] = 200;
		Positions.GetAbiData()[6] = Positions.GetAbiData()[9] = -200;
		const boids::FWorldBounds Bounds = {{25, 25, 25}};
		boids::FNeighborSearch Search;
		for (const int Kind : {0, 1, 2, 0})
		{
			for (const int Count : {boids::constants::MaxBirdCount, 1, 64})
			{
				Search.Rebuild(static_cast<boids::ESearchMethod>(Kind), Positions, Count, Bounds, 10);
				for (const int QueryIndex : {0, Count / 2, Count - 1})
				{
					const int Offset = QueryIndex * 3;
					for (const double Radius : {4.0, 10.0, 16.0, 500.0})
					{
						const std::vector<int>& View = Search.QueryCandidates(boids::FVector3D::Load(Positions.GetAbiData() + Offset), Radius);
						if (static_cast<int>(View.size()) < 0 || static_cast<int>(View.size()) > Count)
						{
							return false;
						}
						std::array<bool, boids::constants::MaxBirdCount> bSeen{};
						for (int CandidateOffset = 0; CandidateOffset < static_cast<int>(View.size()); ++CandidateOffset)
						{
							const int Candidate = View.data()[CandidateOffset];
							if (Candidate < 0 || Candidate >= Count || bSeen[Candidate])
							{
								return false;
							}
							bSeen[Candidate] = true;
						}
						for (int Index = 0; Index < Count; ++Index)
						{
							double DistanceSq = 0;
							for (int Axis = 0; Axis < 3; ++Axis)
							{
								const double Delta = static_cast<double>(Positions.GetAbiData()[Offset + Axis]) - Positions.GetAbiData()[Index * 3 + Axis];
								DistanceSq += Delta * Delta;
							}
							// 후보는 broadphase 상위집합이며 구 밖의 후보를 반환해도 허용합니다.
							if (DistanceSq < Radius * Radius && !bSeen[Index])
							{
								return false;
							}
						}
					}
				}
			}
		}
		return true;
	}

	bool EmptySearchIndexes()
	{
		const boids::FBirdVectorBuffer Positions;
		const boids::FWorldBounds Bounds = {{25, 25, 25}};
		std::vector<int> Candidates;
		Candidates.reserve(boids::constants::MaxBirdCount);
		Candidates.assign(boids::constants::MaxBirdCount, -123);
		boids::FSpatialGrid Grid;
		boids::FKdTree Tree;
		Grid.Rebuild(Positions, 1, Bounds, 10);
		Tree.Rebuild(Positions, 1);
		Grid.Rebuild(Positions, 0, Bounds, 10);
		Tree.Rebuild(Positions, 0);
		const std::vector<int>::size_type ReservedCapacity = Candidates.capacity();
		Grid.QueryCandidates({0, 0, 0}, 10, Candidates);
		if (!Candidates.empty() || Candidates.capacity() != ReservedCapacity)
		{
			return false;
		}
		Candidates.assign(boids::constants::MaxBirdCount, -123);
		Tree.QueryCandidates({0, 0, 0}, 10, Candidates);
		if (!Candidates.empty() || Candidates.capacity() != ReservedCapacity)
		{
			return false;
		}
		boids::FNeighborSearch Search;
		for (const int Kind : {0, 1, 2})
		{
			Search.Rebuild(static_cast<boids::ESearchMethod>(Kind), Positions, 1, Bounds, 10);
			Search.Rebuild(static_cast<boids::ESearchMethod>(Kind), Positions, 0, Bounds, 10);
			if (!Search.QueryCandidates({0, 0, 0}, 10).empty())
			{
				return false;
			}
		}
		return true;
	}

	bool KdTreeOwnsQuerySnapshot()
	{
		boids::FKdTree Tree;
		const std::array<boids::FVector3D, 3> Queries = {{{-12, 0, 0}, {0, 0, 0}, {12, 0, 0}}};
		std::array<std::vector<int>, 3> Expected;
		std::vector<int> Actual;
		{
			boids::FBirdVectorBuffer Positions;
			for (int Index = 0; Index < 9; ++Index)
			{
				Positions.SetVector(Index, {Index * 3.0 - 12, 0, 0});
			}
			Tree.Rebuild(Positions, 9);
			for (std::size_t Index = 0; Index < Queries.size(); ++Index)
			{
				Tree.QueryCandidates(Queries[Index], 4, Expected[Index]);
			}
			// 구축 원본의 변경과 수명 종료는 이미 구축한 탐색 스냅샷을 바꾸지 않습니다.
			for (int Index = 0; Index < 9; ++Index)
			{
				Positions.SetVector(Index, {200, 200, 200});
			}
			for (std::size_t Index = 0; Index < Queries.size(); ++Index)
			{
				Tree.QueryCandidates(Queries[Index], 4, Actual);
				if (Actual != Expected[Index])
				{
					return false;
				}
			}
		}
		for (std::size_t Index = 0; Index < Queries.size(); ++Index)
		{
			Tree.QueryCandidates(Queries[Index], 4, Actual);
			if (Actual != Expected[Index])
			{
				return false;
			}
		}
		const boids::FBirdVectorBuffer Empty;
		Tree.Rebuild(Empty, 0);
		Tree.QueryCandidates({0, 0, 0}, 4, Actual);
		return Actual.empty();
	}

	bool AsymmetricGridOracle()
	{
		boids::FBirdVectorBuffer Positions;
		for (int Index = 0; Index < 64; ++Index)
		{
			Positions.SetVector(Index, {(Index % 8) * 10.0 - 35, (Index % 5) * 7.0 - 10, (Index / 8) * 7.0 - 25});
		}
		Positions.SetVector(0, {-200, -200, -200});
		Positions.SetVector(1, {-199, -199, -199});
		Positions.SetVector(62, {199, 199, 199});
		Positions.SetVector(63, {200, 200, 200});
		boids::FSpatialGrid Grid;
		// 축별 셀 개수가 다르고 Y/Z 끝 셀은 월드 폭을 나누어떨어지게 덮지 않습니다.
		Grid.Rebuild(Positions, 64, {{35, 10, 25}}, 7);
		return MatchesOracle(Grid, Positions, 64);
	}

	bool NeighborhoodSettingsAreFresh()
	{
		boids::FSimulationConfig Config;
		Config.Bounds = {{25, 25, 25}};
		Config.CellSize = 5;
		const boids::FObstacleSet Obstacles;
		const boids::FGoal Goal;
		const boids::FPredator Predator;
		const boids::FFlockContext Context{Config, Obstacles, 4, Goal, Predator};
		boids::FBirdFlock Flock;
		const boids::FBirdFlockBuffers Buffers = Flock.GetAbiBuffers();
		const std::array<float, 12> Positions = {0, 0, 0, 2, 0, 0, -2, 0, 0, 10, 0, 0};
		const std::array<float, 12> Velocities = {5, 0, 0, 5, 0, 0, 5, 0, 0, 5, 0, 0};
		std::copy(Positions.begin(), Positions.end(), Buffers.Positions);
		std::copy(Velocities.begin(), Velocities.end(), Buffers.Velocities);
		auto CheckCounts = [&](double FieldOfView, double Radius, const std::array<std::uint16_t, 4>& Expected)
		{
			Config.FieldOfViewDegrees = FieldOfView;
			Config.PerceptionRadius = Radius;
			Flock.RefreshNeighborhoodCounts(Context);
			if (!std::equal(Expected.begin(), Expected.end(), Buffers.NeighborCounts))
			{
				return false;
			}
			// 속도 적분 경로도 최신 설정을 사용하며 현재 위치·속도 스냅샷은 변경하지 않습니다.
			Flock.IntegrateNextVelocities(1.0 / 60, Context);
			if (!std::equal(Expected.begin(), Expected.end(), Buffers.NeighborCounts) || !std::equal(Positions.begin(), Positions.end(), Buffers.Positions) || !std::equal(Velocities.begin(), Velocities.end(), Buffers.Velocities))
			{
				return false;
			}
			for (int Index = 0; Index < Context.ActiveBirdCount; ++Index)
			{
				Flock.UpdateBirdInspection(Index, Context);
				if (Buffers.Inspection[boids::constants::InspectionNeighborCount] != Expected[Index])
				{
					return false;
				}
			}
			return true;
		};
		for (const boids::ESearchMethod Method : {boids::ESearchMethod::Grid, boids::ESearchMethod::KdTree, boids::ESearchMethod::AllPairs})
		{
			Config.SearchMethod = Method;
			if (!CheckCounts(90, 6, {1, 0, 2, 0}) || !CheckCounts(360, 6, {2, 2, 2, 0}) || !CheckCounts(360, 2, {0, 0, 0, 0}) || !CheckCounts(360, 3, {2, 1, 1, 0}) || !CheckCounts(90, 6, {1, 0, 2, 0}))
			{
				return false;
			}
		}
		return true;
	}

	bool ActorStateContracts()
	{
		const boids::FWorldBounds Bounds = {{25, 25, 25}};
		const boids::FBirdVectorBuffer BoidPosition;
		boids::FGoal Goal;
		boids::FGoal OtherGoal;
		float* GoalPosition = Goal.GetPositionAbiData();
		Goal.Update(0, Bounds);
		if (GoalPosition != Goal.GetPositionAbiData() || GoalPosition == OtherGoal.GetPositionAbiData() || GoalPosition[0] != 17 || GoalPosition[1] != 3 || GoalPosition[2] != 0)
		{
			return false;
		}
		boids::FPredator Predator;
		boids::FPredator OtherPredator;
		float* Position = Predator.GetPositionAbiData();
		float* Previous = Predator.GetPreviousPositionAbiData();
		float* Velocity = Predator.GetVelocityAbiData();
		Previous[0] = 123;
		Predator.Reset(Bounds, 5);
		if (Position == OtherPredator.GetPositionAbiData() || Position[0] != -18 || Position[1] != 8 || Position[2] != 15 || Velocity[0] != 4 || Velocity[1] != 0 || Velocity[2] != -3 || Previous[0] != 123)
		{
			return false;
		}
		Predator.SnapInterpolation();
		if (!std::equal(Position, Position + 3, Previous))
		{
			return false;
		}
		const std::array<float, 3> Initial = {Position[0], Position[1], Position[2]};
		Previous[0] = 123;
		Predator.Update(1.0 / 60, BoidPosition, 1, Bounds, false, 14, false);
		if (!std::equal(Position, Position + 3, Initial.begin()) || !std::equal(Position, Position + 3, Previous) || Velocity[0] != 4 || Velocity[2] != -3)
		{
			return false;
		}
		Predator.Update(1.0 / 60, BoidPosition, 1, Bounds, true, 0, false);
		if (!std::equal(Position, Position + 3, Initial.begin()) || Velocity[0] != 0 || Velocity[1] != 0 || Velocity[2] != 0)
		{
			return false;
		}
		Position[0] = 30;
		Position[1] = -30;
		Position[2] = 30;
		Velocity[0] = 2;
		Velocity[1] = -3;
		Velocity[2] = -4;
		Predator.ReconcileBounds(Bounds);
		return Position[0] == 24 && Position[1] == -24 && Position[2] == 24 && Velocity[0] == 0 && Velocity[1] == 0 && Velocity[2] == -4 && std::equal(Previous, Previous + 3, Initial.begin()) && Position == Predator.GetPositionAbiData() && Previous == Predator.GetPreviousPositionAbiData() && Velocity == Predator.GetVelocityAbiData();
	}

	void Configure(boids::FSimulation& Simulation)
	{
		using namespace boids;
		double* ConfigValues = static_cast<double*>(Simulation.GetAbiBuffer(0));
		ConfigValues[Count] = 32;
		ConfigValues[Perception] = 10;
		ConfigValues[FieldOfView] = 360;
		ConfigValues[HalfX] = ConfigValues[HalfY] = ConfigValues[HalfZ] = 25;
		ConfigValues[CellSize] = 10;
		Simulation.Reset(7);
	}

	bool ActorAbiAddresses()
	{
		boids::FSimulation Simulation;
		Configure(Simulation);
		std::array<void*, 4> Addresses;
		for (int Index = 0; Index < 4; ++Index)
		{
			Addresses[Index] = Simulation.GetAbiBuffer(7 + Index);
			if (Addresses[Index] == nullptr)
			{
				return false;
			}
			for (int Other = 0; Other < Index; ++Other)
			{
				if (Addresses[Index] == Addresses[Other])
				{
					return false;
				}
			}
		}
		Simulation.Step(1.0 / 60);
		Simulation.SnapInterpolation();
		Simulation.ReconcileBounds();
		Configure(Simulation);
		for (int Index = 0; Index < 4; ++Index)
		{
			if (Addresses[Index] != Simulation.GetAbiBuffer(7 + Index))
			{
				return false;
			}
		}
		return Simulation.GetAbiBuffer(-1) == nullptr && Simulation.GetAbiBuffer(14) == nullptr;
	}

	bool IsolatedInstances()
	{
		static_assert(!std::is_copy_constructible_v<boids::FSimulation>);
		static_assert(!std::is_move_constructible_v<boids::FSimulation>);
		static_assert(!std::is_copy_assignable_v<boids::FSimulation>);
		static_assert(!std::is_move_assignable_v<boids::FSimulation>);
		boids::FSimulation FirstSimulation;
		boids::FSimulation SecondSimulation;
		Configure(FirstSimulation);
		Configure(SecondSimulation);
		float* First = static_cast<float*>(FirstSimulation.GetAbiBuffer(2));
		float* Second = static_cast<float*>(SecondSimulation.GetAbiBuffer(2));
		const float Snapshot = Second[0];
		if (First == Second)
		{
			return false;
		}
		FirstSimulation.Step(1.0 / 60);
		if (Second[0] != Snapshot)
		{
			return false;
		}
		SecondSimulation.Step(1.0 / 60);
		for (int Index = 0; Index < 32 * 3; ++Index)
		{
			if (First[Index] != Second[Index])
			{
				return false;
			}
		}
		return true;
	}

	double AdvanceFlock(boids::FBirdFlock& Flock, const boids::FFlockContext& Context)
	{
		Flock.RebuildNeighborSearch(Context);
		const double Checks = Flock.IntegrateNextVelocities(1.0 / 60, Context);
		Flock.CommitVelocitiesAndIntegratePositions(1.0 / 60, Context);
		return Checks;
	}

	bool SameFlockState(const boids::FBirdFlockBuffers& First, const boids::FBirdFlockBuffers& Second, int Count)
	{
		return std::equal(First.Positions, First.Positions + Count * 3, Second.Positions) && std::equal(First.PreviousPositions, First.PreviousPositions + Count * 3, Second.PreviousPositions) && std::equal(First.Velocities, First.Velocities + Count * 3, Second.Velocities) && std::equal(First.NextVelocities, First.NextVelocities + Count * 3, Second.NextVelocities) && std::equal(First.NeighborCounts, First.NeighborCounts + Count, Second.NeighborCounts);
	}

	bool BirdFlockIsolation(const boids::FFlockContext& Context)
	{
		static_assert(!std::is_copy_constructible_v<boids::FBirdFlock>);
		static_assert(!std::is_move_constructible_v<boids::FBirdFlock>);
		static_assert(!std::is_copy_assignable_v<boids::FBirdFlock>);
		static_assert(!std::is_move_assignable_v<boids::FBirdFlock>);
		boids::FBirdFlock First;
		boids::FBirdFlock Second;
		if (First.GetPositions().GetBirdCapacity() != boids::constants::MaxBirdCount || Second.GetPositions().GetBirdCapacity() != boids::constants::MaxBirdCount)
		{
			return false;
		}
		First.Reset(7, Context);
		const boids::FBirdFlockBuffers Initial = First.GetAbiBuffers();
		std::array<float, 96> InitialPositions;
		std::array<float, 96> InitialVelocities;
		std::copy_n(Initial.Positions, 96, InitialPositions.begin());
		std::copy_n(Initial.Velocities, 96, InitialVelocities.begin());
		Second.Reset(0, Context);
		const boids::FBirdFlockBuffers SecondSeed = Second.GetAbiBuffers();
		if (!std::equal(Initial.Positions, Initial.Positions + 96, InitialPositions.begin()) || !std::equal(Initial.Velocities, Initial.Velocities + 96, InitialVelocities.begin()) || std::equal(Initial.Positions, Initial.Positions + 96, SecondSeed.Positions))
		{
			return false;
		}
		Second.Reset(7, Context);
		First.SnapInterpolation();
		Second.SnapInterpolation();
		const boids::FBirdFlockBuffers Other = Second.GetAbiBuffers();
		if (!SameFlockState(First.GetAbiBuffers(), Other, Context.ActiveBirdCount) || Initial.Positions == Other.Positions || Initial.PreviousPositions == Other.PreviousPositions || Initial.Velocities == Other.Velocities || Initial.NextVelocities == Other.NextVelocities || Initial.NeighborCounts == Other.NeighborCounts || Initial.Inspection == Other.Inspection || Initial.InspectionNeighborIndices == Other.InspectionNeighborIndices || First.GetPositions().GetAbiData() != Initial.Positions)
		{
			return false;
		}
		const float* OtherArrays[4] = {Other.Positions, Other.PreviousPositions, Other.Velocities, Other.NextVelocities};
		std::array<std::array<float, 96>, 4> OtherSnapshot;
		for (int Index = 0; Index < 4; ++Index)
		{
			std::copy_n(OtherArrays[Index], 96, OtherSnapshot[Index].begin());
		}
		const double FirstChecks = AdvanceFlock(First, Context);
		for (int Index = 0; Index < 4; ++Index)
		{
			if (!std::equal(OtherArrays[Index], OtherArrays[Index] + 96, OtherSnapshot[Index].begin()))
			{
				return false;
			}
		}
		if (!std::all_of(Other.NeighborCounts, Other.NeighborCounts + Context.ActiveBirdCount, [](std::uint16_t Value)
		{
			return Value == 0;
		}))
		{
			return false;
		}
		const double SecondChecks = AdvanceFlock(Second, Context);
		const boids::FBirdFlockMetrics FirstMetrics = First.CalculateMetrics(Context);
		const boids::FBirdFlockMetrics SecondMetrics = Second.CalculateMetrics(Context);
		// 전수 탐색은 자기 자신을 제외한 32 * 31개 후보를 검사합니다.
		return FirstChecks == 992 && SecondChecks == FirstChecks && SameFlockState(First.GetAbiBuffers(), Second.GetAbiBuffers(), Context.ActiveBirdCount) && FirstMetrics.MeanSpeed == SecondMetrics.MeanSpeed && FirstMetrics.HeadingAlignment == SecondMetrics.HeadingAlignment && FirstMetrics.OutsideBirdCount == SecondMetrics.OutsideBirdCount && FirstMetrics.MaxBoundaryExcursion == SecondMetrics.MaxBoundaryExcursion;
	}

	bool BirdFlockResetAndViews(const boids::FFlockContext& Context)
	{
		boids::FBirdFlock Flock;
		boids::FBirdFlock Reference;
		Flock.Reset(7, Context);
		Reference.Reset(7, Context);
		const boids::FBirdFlockBuffers Before = Flock.GetAbiBuffers();
		AdvanceFlock(Flock, Context);
		const boids::FBirdFlockBuffers AfterStep = Flock.GetAbiBuffers();
		if (AfterStep.Velocities == Before.Velocities || AfterStep.Velocities != Before.NextVelocities || AfterStep.NextVelocities != Before.Velocities || AfterStep.Positions != Before.Positions || AfterStep.PreviousPositions != Before.PreviousPositions)
		{
			return false;
		}
		const int CapacityValues = boids::constants::MaxBirdCount * 3;
		const int ActiveValues = Context.ActiveBirdCount * 3;
		std::fill_n(AfterStep.Positions, CapacityValues, 41.0f);
		std::fill_n(AfterStep.PreviousPositions, CapacityValues, 42.0f);
		std::fill_n(AfterStep.Velocities, CapacityValues, 43.0f);
		std::fill_n(AfterStep.NextVelocities, CapacityValues, 44.0f);
		std::fill_n(AfterStep.NeighborCounts, boids::constants::MaxBirdCount, std::uint16_t{65535});
		Flock.Reset(7, Context);
		const boids::FBirdFlockBuffers AfterReset = Flock.GetAbiBuffers();
		const boids::FBirdFlockBuffers Expected = Reference.GetAbiBuffers();
		if (AfterReset.Velocities != AfterStep.Velocities || AfterReset.NextVelocities != AfterStep.NextVelocities || !std::equal(AfterReset.Positions, AfterReset.Positions + ActiveValues, Expected.Positions) || !std::equal(AfterReset.Velocities, AfterReset.Velocities + ActiveValues, Expected.Velocities))
		{
			return false;
		}
		for (int Index = 0; Index < CapacityValues; ++Index)
		{
			if (AfterReset.PreviousPositions[Index] != 42 || AfterReset.NextVelocities[Index] != 44 || (Index >= ActiveValues && (AfterReset.Positions[Index] != 41 || AfterReset.Velocities[Index] != 43)))
			{
				return false;
			}
		}
		if (!std::all_of(AfterReset.NeighborCounts, AfterReset.NeighborCounts + boids::constants::MaxBirdCount, [](std::uint16_t Value)
		{
			return Value == 0;
		}))
		{
			return false;
		}
		Flock.SnapInterpolation();
		return std::equal(AfterReset.Positions, AfterReset.Positions + CapacityValues, AfterReset.PreviousPositions);
	}

	bool BirdFlockContracts()
	{
		using namespace boids;
		FSimulationConfig Config;
		Config.RequestedBirdCount = 32;
		Config.PerceptionRadius = 10;
		Config.FieldOfViewDegrees = 360;
		Config.Bounds = {{25, 25, 25}};
		Config.CellSize = 10;
		Config.SearchMethod = ESearchMethod::AllPairs;
		FObstacleSet Obstacles;
		FGoal Goal;
		FPredator Predator;
		const FFlockContext Context = {Config, Obstacles, 32, Goal, Predator};
		return BirdFlockIsolation(Context) && BirdFlockResetAndViews(Context);
	}

	bool BirdVectorBufferContracts()
	{
		using namespace boids;
		static_assert(!std::is_copy_constructible_v<FBirdVectorBuffer>);
		static_assert(!std::is_move_constructible_v<FBirdVectorBuffer>);
		FBirdVectorBuffer Source;
		FBirdVectorBuffer Destination;
		float* SourceData = Source.GetAbiData();
		float* DestinationData = Destination.GetAbiData();
		const int LastBirdIndex = constants::MaxBirdCount - 1;
		Source.SetVector(0, {16777217.0, 4, -2.5});
		Source.SetVector(LastBirdIndex, {9, -3, 0.125});
		Source.GetComponent(1, EAxis::Z) = -0.0f;
		const FVector3D Rounded = Source.GetVector(0);
		Destination.CopyFrom(Source);
		Destination.CopyFrom(Destination);
		const FBirdVectorBuffer& ConstDestination = Destination;
		return Rounded.X == 16777216.0 && Rounded.Y == 4 && Rounded.Z == -2.5 && SourceData == Source.GetAbiData() && DestinationData == Destination.GetAbiData() && SourceData != DestinationData && ConstDestination.GetBirdCapacity() == constants::MaxBirdCount && &ConstDestination.GetComponent(LastBirdIndex, EAxis::Z) == DestinationData + constants::BirdVectorComponentCount - 1 && std::memcmp(SourceData, DestinationData, constants::BirdVectorComponentCount * sizeof(float)) == 0;
	}

	bool VectorContracts()
	{
		using namespace boids;
		static_assert(sizeof(FVector3f) == 12);
		static_assert(std::is_standard_layout_v<FVector3f>);
		static_assert(!TAcceptsIntegerAxis<FVector3D>::value);
		static_assert(!TAcceptsIntegerAxis<FVector3f>::value);
		static_assert(!TAcceptsIntegerAxis<const FVector3D>::value);
		static_assert(!TAcceptsIntegerAxis<const FVector3f>::value);
		static_assert(std::is_same_v<decltype(FVector3f::Components), std::array<float, constants::AxisCount>>);
		static_assert(std::is_same_v<decltype(std::declval<FVector3D&>()[EAxis::X]), double&>);
		static_assert(std::is_same_v<decltype(std::declval<const FVector3D&>()[EAxis::X]), const double&>);
		static_assert(std::is_same_v<decltype(std::declval<FVector3f&>()[EAxis::X]), float&>);
		static_assert(std::is_same_v<decltype(std::declval<const FVector3f&>()[EAxis::X]), const float&>);
		const float Values[3] = {0.1f, -2.5f, 8.0f};
		FVector3D Loaded = FVector3D::Load(Values);
		if (Loaded.X != 0.10000000149011612 || Loaded.Y != -2.5 || Loaded.Z != 8 || &Loaded[EAxis::X] != &Loaded.X || &Loaded[EAxis::Y] != &Loaded.Y || &Loaded[EAxis::Z] != &Loaded.Z)
		{
			return false;
		}
		Loaded[EAxis::X] = 3;
		Loaded[EAxis::Y] = 4;
		Loaded[EAxis::Z] = 0;
		const FVector3D& ConstLoaded = Loaded;
		if (&ConstLoaded[EAxis::Y] != &Loaded.Y || Loaded.Length() != 5 || Loaded.LengthSquared() != 25 || Loaded.Dot({2, -1, 7}) != 2)
		{
			return false;
		}
		FVector3f Stored;
		float* Data = Stored.GetData();
		Data[0] = static_cast<float>(16777217.0);
		Stored[EAxis::Y] = 4;
		Stored[EAxis::Z] = -2.5f;
		const FVector3f& ConstStored = Stored;
		const FVector3D Promoted = ConstStored.ToDouble();
		return Data == Stored.Components.data() && Data == ConstStored.GetData() && &Stored[EAxis::X] == &Data[0] && &ConstStored[EAxis::Z] == &Data[2] && Data[0] == 16777216.0f && Data[1] == 4 && Data[2] == -2.5f && Promoted.X == 16777216.0 && Promoted.Y == 4 && Promoted.Z == -2.5;
	}

	bool VectorOperatorsAndBounds()
	{
		using namespace boids;
		if (AllAxes != std::array<EAxis, 3>{EAxis::X, EAxis::Y, EAxis::Z} || ToIndex(EAxis::X) != 0 || ToIndex(EAxis::Y) != 1 || ToIndex(EAxis::Z) != 2)
		{
			return false;
		}
		const FVector3D First = {3, -6, 9};
		const FVector3D Second = {1, 2, -3};
		const FVector3D Sum = First + Second;
		const FVector3D Difference = First - Second;
		const FVector3D Scaled = First * 2;
		const FVector3D LeftScaled = 2 * First;
		const FVector3D Divided = First / 10;
		if (Sum.X != 4 || Sum.Y != -4 || Sum.Z != 6 || Difference.X != 2 || Difference.Y != -8 || Difference.Z != 12 || Scaled.X != 6 || Scaled.Y != -12 || Scaled.Z != 18 || LeftScaled.X != 6 || LeftScaled.Y != -12 || LeftScaled.Z != 18 || Divided.X != 0.3 || Divided.Y != -0.6 || Divided.Z != 0.9)
		{
			return false;
		}
		FVector3D Compound = First;
		if (&(Compound += Second) != &Compound || Compound.X != 4 || Compound.Y != -4 || Compound.Z != 6 || &(Compound -= Second) != &Compound || Compound.X != 3 || Compound.Y != -6 || Compound.Z != 9 || &(Compound *= 2) != &Compound || Compound.X != 6 || Compound.Y != -12 || Compound.Z != 18 || &(Compound /= 20) != &Compound || Compound.X != 0.3 || Compound.Y != -0.6 || Compound.Z != 0.9)
		{
			return false;
		}
		const FVector3D Negated = -FVector3D{0.0, -0.0, 2};
		if (Negated.X != 0 || !std::signbit(Negated.X) || Negated.Y != 0 || std::signbit(Negated.Y) || Negated.Z != -2)
		{
			return false;
		}
		const FWorldBounds Original = {{10, 20, 30}};
		FWorldBounds Copy = Original;
		Copy.HalfExtents[EAxis::X] = 25;
		return Original.HalfExtents.X == 10 && Copy.HalfExtents.X == 25 && Copy.HalfExtents[EAxis::Y] == 20 && Copy.HalfExtents[EAxis::Z] == 30;
	}

	bool TypedAbiContracts()
	{
		using namespace boids;
		static_assert(!std::is_copy_constructible_v<FSimulationAbi>);
		static_assert(!std::is_move_constructible_v<FSimulationAbi>);
		static_assert(!std::is_copy_assignable_v<FSimulationAbi>);
		static_assert(!std::is_move_assignable_v<FSimulationAbi>);
		FSimulationAbi Abi;
		double* Raw = Abi.GetConfigAbiData();
		Raw[Count] = 32;
		Raw[Cohesion] = 0.85;
		Raw[Perception] = 14;
		Raw[FieldOfView] = 220;
		Raw[GoalEnabled] = 1;
		Raw[PredatorEnabled] = 0;
		Raw[ObstaclesEnabled] = 1;
		Raw[BoundaryMode] = 1;
		Raw[SearchType] = 2;
		Raw[HalfX] = 25;
		Raw[HalfY] = 35;
		Raw[HalfZ] = 45;
		Raw[CellSize] = 10;
		Raw[ObstacleCount] = 16;
		std::array<double, ConfigSize> Snapshot;
		std::copy_n(Raw, ConfigSize, Snapshot.begin());
		const FSimulationConfig Config = Abi.ReadConfigSnapshot();
		if (std::memcmp(Raw, Snapshot.data(), sizeof(Snapshot)) != 0 || Config.RequestedBirdCount != 32 || Config.CohesionWeight != 0.85 || Config.PerceptionRadius != 14 || Config.FieldOfViewDegrees != 220 || !Config.bGoalEnabled || Config.bPredatorEnabled || !Config.bObstaclesEnabled || Config.BoundaryMode != EBoundaryMode::Soft || Config.SearchMethod != ESearchMethod::AllPairs || Config.Bounds.HalfExtents.X != 25 || Config.Bounds.HalfExtents.Y != 35 || Config.Bounds.HalfExtents.Z != 45 || Config.CellSize != 10 || Config.ObstacleCount != 16)
		{
			return false;
		}
		Raw[Count] = 64;
		if (Config.RequestedBirdCount != 32 || Abi.ReadConfigSnapshot().RequestedBirdCount != 64)
		{
			return false;
		}
		double* RawState = Abi.GetStateAbiData();
		for (int Index = 0; Index < StateSize; ++Index)
		{
			RawState[Index] = 100 + Index;
		}
		FSimulationState State = Abi.ReadStateSnapshot();
		const FSimulationStateSnapshot& StateView = State.GetSnapshot();
		const std::array<double, StateSize> Imported = {StateView.ActiveBirdCount, StateView.SimulationTime, StateView.GoalPhaseTime, StateView.PreviousGoalPhaseTime, StateView.GoalPhaseAdvance, StateView.NeighborDistanceChecks, StateView.MeanSpeed, StateView.HeadingAlignment, StateView.OutsideBirdCount, StateView.MaxBoundaryExcursion};
		for (int Index = 0; Index < StateSize; ++Index)
		{
			if (Imported[Index] != 100 + Index)
			{
				return false;
			}
		}
		FSimulationState Copy = State;
		RawState[Time] = 1.25;
		FSimulationStateSnapshot Edited = State.GetSnapshot();
		Edited.GoalPhaseTime = 3.5;
		State = FSimulationState(Edited);
		if (StateView.SimulationTime != 101 || Copy.GetSnapshot().GoalPhaseTime != 102 || RawState[GoalTime] != 102 || Copy.GetSnapshot().SimulationTime != 101)
		{
			return false;
		}
		const FSimulationAbi& ConstAbi = Abi;
		if (ConstAbi.GetConfigAbiData() != Raw || ConstAbi.GetStateAbiData() != RawState || Abi.ReadStateSnapshot().GetSnapshot().SimulationTime != 1.25)
		{
			return false;
		}
		for (const EBoundaryMode Mode : {EBoundaryMode::Hard, EBoundaryMode::Soft, EBoundaryMode::Hybrid})
		{
			Raw[BoundaryMode] = static_cast<double>(Mode);
			const FSimulationConfig Policy = Abi.ReadConfigSnapshot();
			if (Policy.IsSoftBoundary() != (Mode == EBoundaryMode::Soft) || Policy.UsesBoundarySteering() != (Mode != EBoundaryMode::Hard))
			{
				return false;
			}
		}
		return true;
	}

	std::array<double, boids::StateSize> StateValues(const boids::FSimulationState& State)
	{
		const boids::FSimulationStateSnapshot& Snapshot = State.GetSnapshot();
		return {Snapshot.ActiveBirdCount, Snapshot.SimulationTime, Snapshot.GoalPhaseTime, Snapshot.PreviousGoalPhaseTime, Snapshot.GoalPhaseAdvance, Snapshot.NeighborDistanceChecks, Snapshot.MeanSpeed, Snapshot.HeadingAlignment, Snapshot.OutsideBirdCount, Snapshot.MaxBoundaryExcursion};
	}

	bool SimulationStateCommandContracts()
	{
		using namespace boids;
		static_assert(std::is_same_v<decltype(std::declval<FSimulationState&>().GetSnapshot()), const FSimulationStateSnapshot&>);
		FSimulationStateSnapshot Imported{7, 10, 2, 1, 0.5, 11, 6, 0.7, 2, 0.25};
		FSimulationState State(Imported);
		const FSimulationStateSnapshot Saved = State.GetSnapshot();
		const FSimulationStateSnapshot& View = State.GetSnapshot();
		Imported.GoalPhaseTime = 99;
		State.AdvanceTime(0.25, true, 2);
		if (View.SimulationTime != 10.25 || View.PreviousGoalPhaseTime != 2 || View.GoalPhaseAdvance != 0.5 || View.GoalPhaseTime != 2.5 || Saved.GoalPhaseTime != 2)
		{
			return false;
		}
		State.SnapGoalInterpolation();
		if (View.PreviousGoalPhaseTime != 2.5 || View.GoalPhaseAdvance != 0)
		{
			return false;
		}
		State.AdvanceTime(0.5, false, 99);
		if (View.SimulationTime != 10.75 || View.PreviousGoalPhaseTime != 2.5 || View.GoalPhaseAdvance != 0 || View.GoalPhaseTime != 2.5)
		{
			return false;
		}
		State.RecordNeighborDistanceChecks(123);
		if (View.NeighborDistanceChecks != 123)
		{
			return false;
		}
		State.SetFlockMetrics(8, 0.9, 4, 0.5);
		State.ResetForBirdCount(32);
		// Reset은 시간·활성 수·검사수를 초기화하며 통계 4개는 다음 측정 전까지 유지합니다.
		return StateValues(State) == std::array<double, StateSize>{32, 0, 0, 0, 0, 0, 8, 0.9, 4, 0.5} && Saved.ActiveBirdCount == 7 && Saved.SimulationTime == 10 && Saved.MeanSpeed == 6;
	}

	bool SelectiveStatePublication()
	{
		using namespace boids;
		FSimulationAbi Abi;
		double* Raw = Abi.GetStateAbiData();
		for (int Index = 0; Index < StateSize; ++Index)
		{
			Raw[Index] = 200 + Index;
		}
		const FSimulationState State = Abi.ReadStateSnapshot();
		const std::array<double, StateSize> Expected = StateValues(State);
		using FPublish = void (FSimulationAbi::*)(const FSimulationState&);
		auto Check = [&](FPublish Publish, unsigned WriteMask)
		{
			std::array<double, StateSize> Before;
			for (int Index = 0; Index < StateSize; ++Index)
			{
				Raw[Index] = Index % 2 == 0 ? 300 + Index : -0.0;
			}
			std::copy_n(Raw, StateSize, Before.begin());
			(Abi.*Publish)(State);
			for (int Index = 0; Index < StateSize; ++Index)
			{
				if ((WriteMask & (1u << Index)) != 0)
				{
					if (Raw[Index] != Expected[Index])
					{
						return false;
					}
				}
				else if (std::memcmp(Raw + Index, Before.data() + Index, sizeof(double)) != 0)
				{
					return false;
				}
			}
			return true;
		};
		// 승인된 entry별 ABI 출력 집합입니다. 외부 raw 수정과 snapshot은 서로 다릅니다.
		return Check(&FSimulationAbi::PublishResetState, 0x3FFu) && Check(&FSimulationAbi::PublishStepState, 0x3FEu) && Check(&FSimulationAbi::PublishGoalInterpolationState, (1u << 3) | (1u << 4)) && Check(&FSimulationAbi::PublishFlockMetrics, 0x3C0u);
	}

	bool SyncPreservesRaw(boids::FSimulationAbi& Abi, boids::FObstacleSet& Obstacles, int Count)
	{
		std::array<double, boids::MaxObstacles * 8> Snapshot;
		std::copy_n(Abi.GetObstacleRecordsAbiData(), Snapshot.size(), Snapshot.begin());
		const double* Address = Abi.GetObstacleRecordsAbiData();
		const boids::FObstacleDescriptorSnapshot SnapshotValues = Abi.ReadObstacleSnapshot(Count);
		Obstacles.Synchronize(SnapshotValues);
		return Address == Abi.GetObstacleRecordsAbiData() && Obstacles.GetActiveObstacleCount() == Count && std::memcmp(Address, Snapshot.data(), sizeof(Snapshot)) == 0;
	}

	bool ObstacleShapeContracts()
	{
		using namespace boids;
		static_assert(std::is_abstract_v<FObstacle>);
		static_assert(std::is_base_of_v<FObstacle, FSphereObstacle>);
		static_assert(std::is_base_of_v<FObstacle, FBoxObstacle>);
		static_assert(std::is_destructible_v<FObstacle>);
		static_assert(std::has_virtual_destructor_v<FObstacle>);
		static_assert(std::is_destructible_v<FObstacleSet>);
		static_assert(!std::is_copy_constructible_v<FObstacleSet>);
		static_assert(!std::is_move_constructible_v<FObstacleSet>);
		static_assert(!std::is_copy_assignable_v<FObstacleSet>);
		static_assert(!std::is_move_assignable_v<FObstacleSet>);
		FSimulationAbi Abi;
		FObstacleSet Obstacles;
		double* Raw = Abi.GetObstacleRecordsAbiData();
		for (int Index = 0; Index < MaxObstacles; ++Index)
		{
			Raw[Index * 8] = 0;
			Raw[Index * 8 + 1] = Index * 10;
			Raw[Index * 8 + 4] = 2;
			Raw[Index * 8 + 5] = Raw[Index * 8 + 6] = Raw[Index * 8 + 7] = 4;
		}
		// 비활성 tail의 signed zero까지 Sync 전후 byte 단위로 보존합니다.
		Raw[MaxObstacles * 8 - 1] = -0.0;
		if (!SyncPreservesRaw(Abi, Obstacles, 1))
		{
			return false;
		}
		const FObstacleDescriptorSnapshot IndependentSnapshot = Abi.ReadObstacleSnapshot(1);
		Raw[1] = 99;
		Obstacles.Synchronize(IndependentSnapshot);
		FVector3D Normal;
		const FObstacle& Sphere = Obstacles.GetObstacle(0);
		if (Sphere.CalculateSignedDistance({3, 0, 0}, Normal) != 1 || Normal.X != 1 || Normal.Y != 0 || Normal.Z != 0 || Sphere.GetAvoidanceFalloffLength(4) != 6 || IndependentSnapshot.Descriptors[0].Center.X != 0 || Raw[1] != 99)
		{
			return false;
		}
		Raw[1] = 0;
		Raw[0] = 1;
		if (!SyncPreservesRaw(Abi, Obstacles, 1))
		{
			return false;
		}
		const FObstacle& Box = Obstacles.GetObstacle(0);
		const FObstacle* BoxAddress = &Box;
		if (Box.CalculateSignedDistance({3, 0, 0}, Normal) != 1 || Normal.X != 1 || Normal.Y != 0 || Normal.Z != 0 || Box.GetAvoidanceFalloffLength(4) != 4)
		{
			return false;
		}
		Raw[1] = 1;
		if (!SyncPreservesRaw(Abi, Obstacles, 1) || Obstacles.GetObstacle(0).CalculateSignedDistance({6, 0, 0}, Normal) != 3)
		{
			return false;
		}
		Raw[5] = 8;
		if (!SyncPreservesRaw(Abi, Obstacles, 1) || &Obstacles.GetObstacle(0) != BoxAddress || Obstacles.GetObstacle(0).CalculateSignedDistance({6, 0, 0}, Normal) != 1)
		{
			return false;
		}
		Raw[0] = 0;
		Raw[1] = 0;
		if (!SyncPreservesRaw(Abi, Obstacles, 1) || !SyncPreservesRaw(Abi, Obstacles, 0) || !SyncPreservesRaw(Abi, Obstacles, MaxObstacles))
		{
			return false;
		}
		for (int Index = 0; Index < MaxObstacles; ++Index)
		{
			if (Obstacles.GetObstacle(Index).CalculateSignedDistance({Index * 10.0 + 3, 0, 0}, Normal) != 1)
			{
				return false;
			}
		}
		const FSimulationAbi& ConstAbi = Abi;
		return ConstAbi.GetObstacleRecordsAbiData() == Raw;
	}
} // namespace

int main()
{
	if (!SearchOracles())
	{
		std::cerr << "FAIL: native spatial indexes missed an oracle neighbor or returned a duplicate\n";
		return 1;
	}
	if (!NeighborSearchOrderAndLifetime() || !NeighborSearchCapacityOracle() || !EmptySearchIndexes())
	{
		std::cerr << "FAIL: neighbor search order, capacity oracle, empty input or borrowed view "
					 "contract\n";
		return 1;
	}
	if (!KdTreeOwnsQuerySnapshot() || !AsymmetricGridOracle() || !NeighborhoodSettingsAreFresh())
	{
		std::cerr << "FAIL: spatial snapshot lifetime, asymmetric grid or fresh neighborhood settings\n";
		return 1;
	}
	if (!ActorStateContracts() || !ActorAbiAddresses())
	{
		std::cerr << "FAIL: actor state isolation, lifecycle or stable ABI address contract\n";
		return 1;
	}
	if (!IsolatedInstances())
	{
		std::cerr << "FAIL: native Simulation instances share state\n";
		return 1;
	}
	if (!BirdFlockContracts())
	{
		std::cerr << "FAIL: bird flock isolation, reset range or borrowed velocity role contract\n";
		return 1;
	}
	if (!BirdVectorBufferContracts() || !VectorContracts() || !VectorOperatorsAndBounds())
	{
		std::cerr << "FAIL: vector precision, axis reference or float storage contract\n";
		return 1;
	}
	if (!TypedAbiContracts() || !SelectiveStatePublication() || !SimulationStateCommandContracts() || !ObstacleShapeContracts())
	{
		std::cerr << "FAIL: typed ABI snapshot/publication or obstacle polymorphic ownership contract\n";
		return 1;
	}
	std::cout << "PASS: search oracles/order/lifetime, actor state/ABI, flock ownership/reset, "
				 "typed vectors/ABI, obstacle sync and native instance isolation\n";
}
