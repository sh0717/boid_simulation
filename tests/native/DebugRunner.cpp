#include <boids/boids.h>
#include <charconv>
#include <iomanip>
#include <iostream>
#include <string_view>

namespace
{
	// 네이티브 재현 실행의 입력값을 소유하는 단순 설정 묶음입니다.
	struct FScenario
	{
		std::uint32_t Count = 32;
		std::uint32_t Steps = 180;
		std::uint32_t Seed = 22823;
		int Search = 0;
		std::string_view SearchName = "grid";
		bool bJson = false;
	};

	bool Number(std::string_view Text, std::uint32_t& OutValue)
	{
		const std::from_chars_result Result = std::from_chars(Text.data(), Text.data() + Text.size(), OutValue);
		return Result.ec == std::errc{} && Result.ptr == Text.data() + Text.size();
	}

	bool Parse(int Argc, char** Argv, FScenario& OutScenario)
	{
		for (int Index = 1; Index < Argc; ++Index)
		{
			const std::string_view Option = Argv[Index];
			if (Option == "--json")
			{
				OutScenario.bJson = true;
				continue;
			}
			if (Index + 1 >= Argc)
			{
				return false;
			}
			const std::string_view Value = Argv[++Index];
			if (Option == "--count")
			{
				if (!Number(Value, OutScenario.Count))
				{
					return false;
				}
			}
			else if (Option == "--steps")
			{
				if (!Number(Value, OutScenario.Steps))
				{
					return false;
				}
			}
			else if (Option == "--seed")
			{
				if (!Number(Value, OutScenario.Seed))
				{
					return false;
				}
			}
			else if (Option == "--search")
			{
				OutScenario.SearchName = Value;
				if (Value == "grid")
				{
					OutScenario.Search = 0;
				}
				else if (Value == "kd-tree")
				{
					OutScenario.Search = 1;
				}
				else if (Value == "all-pairs")
				{
					OutScenario.Search = 2;
				}
				else
				{
					return false;
				}
			}
			else
			{
				return false;
			}
		}
		return OutScenario.Count >= 1 && OutScenario.Count <= Capacity && OutScenario.Steps >= 1 && OutScenario.Steps <= 36000;
	}

	void Configure(const FScenario& Scenario)
	{
		double* ConfigValues = static_cast<double*>(boids_buffer(0));
		ConfigValues[Count] = Scenario.Count;
		ConfigValues[Cohesion] = 0.85;
		ConfigValues[Alignment] = 1.2;
		ConfigValues[Separation] = 1.65;
		ConfigValues[Perception] = 10;
		ConfigValues[FieldOfView] = 360;
		ConfigValues[GoalEnabled] = 1;
		ConfigValues[GoalSpeed] = 1;
		ConfigValues[GoalStrength] = 1;
		ConfigValues[PredatorEnabled] = 0;
		ConfigValues[PredatorSpeed] = 14;
		ConfigValues[PredatorRadius] = 13;
		ConfigValues[PredatorStrength] = 1;
		ConfigValues[ObstaclesEnabled] = 1;
		ConfigValues[BoundaryMode] = 2;
		ConfigValues[BoundaryMargin] = 5;
		ConfigValues[BoundaryStrength] = 1;
		ConfigValues[SearchType] = Scenario.Search;
		ConfigValues[HalfX] = ConfigValues[HalfY] = ConfigValues[HalfZ] = 25;
		ConfigValues[CellSize] = 10;
		ConfigValues[ObstacleCount] = 2;
		double* Obstacles = static_cast<double*>(boids_buffer(11));
		const double Layout[16] = {0, 0, 0, 0, 4.5, 0, 0, 0, 0, 15, 11, -10, 3.3, 0, 0, 0};
		for (int Index = 0; Index < 16; ++Index)
		{
			Obstacles[Index] = Layout[Index];
		}
	}
} // namespace

int main(int Argc, char** Argv)
{
	FScenario Scenario;
	if (!Parse(Argc, Argv, Scenario))
	{
		std::cerr << "Usage: boids_debug [--count 1..10000] [--steps 1..36000] "
					 "[--seed uint32] [--search grid|kd-tree|all-pairs] [--json]\n";
		return 2;
	}
	Configure(Scenario);
	boids_reset(Scenario.Seed);
	if (!Scenario.bJson)
	{
		std::cout << "C++20 native debug scenario: " << Scenario.SearchName << ", " << Scenario.Count << " boids\n";
	}
	for (std::uint32_t Step = 0; Step < Scenario.Steps; ++Step)
	{
		// Set a breakpoint here, or inside FSimulation::Step / FKdTree::Query.
		boids_step(1.0 / 60.0);
	}
	const double* StateValues = static_cast<const double*>(boids_buffer(1));
	const float* Position = static_cast<const float*>(boids_buffer(2));
	const float* Velocity = static_cast<const float*>(boids_buffer(4));
	std::cout << std::setprecision(12) << "{\"seed\":" << Scenario.Seed << ",\"count\":" << Scenario.Count << ",\"steps\":" << Scenario.Steps << ",\"search\":\"" << Scenario.SearchName << "\",\"time\":" << StateValues[Time] << ",\"position\":[" << Position[0] << ',' << Position[1] << ',' << Position[2] << "],\"velocity\":[" << Velocity[0] << ',' << Velocity[1] << ',' << Velocity[2] << "],\"neighborChecks\":" << StateValues[NeighborChecks] << ",\"meanSpeed\":" << StateValues[MeanSpeed] << "}\n";
}
