#!/usr/bin/env python3

import json
from pathlib import Path

import matplotlib.pyplot as plt
import pandas as pd

REPO_ROOT = Path(__file__).resolve().parents[1]
ANALYSIS_ROOT = REPO_ROOT / "analysis"
CHARTS_ROOT = ANALYSIS_ROOT / "charts"

CONDITION_ORDER = ["baseline_raw", "raw_memory", "distilled_memory"]
CONDITION_COLORS = {
    "baseline_raw": "#4E79A7",
    "raw_memory": "#F28E2B",
    "distilled_memory": "#59A14F",
}

EARLY_START = 1
EARLY_END = 25
ROLLING_WINDOW = 3

plt.style.use("seaborn-v0_8-whitegrid")
plt.rcParams.update(
    {
        "figure.figsize": (11, 6),
        "font.size": 11,
        "axes.labelsize": 12,
        "axes.titlesize": 14,
        "legend.fontsize": 10,
        "xtick.labelsize": 10,
        "ytick.labelsize": 10,
    }
)


def ensure_dir(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)


def load_run_data(scenario: str) -> pd.DataFrame:
    if scenario == "lever":
        run_file = ANALYSIS_ROOT / "lever" / "lever_runs_merged_corrected.csv"
    else:
        run_file = ANALYSIS_ROOT / scenario / f"{scenario}_runs_merged.csv"

    df = pd.read_csv(run_file)
    df = df[df["condition_name"].isin(CONDITION_ORDER)].copy()
    df["trial_index"] = pd.to_numeric(df["trial_index"], errors="coerce")
    df = df[df["trial_index"].between(EARLY_START, EARLY_END)].copy()
    df = df.sort_values(["condition_name", "trial_index"]).reset_index(drop=True)
    return df


def compute_derived_columns(df: pd.DataFrame, scenario: str) -> pd.DataFrame:
    out = []
    for condition in CONDITION_ORDER:
        subset = df[df["condition_name"] == condition].copy()
        subset = subset.sort_values("trial_index").reset_index(drop=True)

        subset["eventual_success_num"] = subset["eventual_success"].astype(float)
        subset["cumulative_success_rate"] = subset["eventual_success_num"].expanding().mean()

        if scenario == "lever":
            subset["attempt_value"] = pd.to_numeric(subset["corrected_attempts"], errors="coerce")
            fas = subset.get("first_attempt_success", pd.Series([None] * len(subset)))
            subset["first_attempt_num"] = pd.to_numeric(fas, errors="coerce")
            subset["cumulative_first_attempt_rate"] = subset["first_attempt_num"].expanding().mean()
        else:
            subset["attempt_value"] = pd.to_numeric(subset["attempts"], errors="coerce")
            subset["first_attempt_num"] = pd.to_numeric(subset.get("first_attempt_success", pd.Series([None] * len(subset))), errors="coerce")
            subset["cumulative_first_attempt_rate"] = subset["first_attempt_num"].expanding().mean()

        subset["runtime_ms_value"] = pd.to_numeric(subset["runtime_ms"], errors="coerce")
        subset["rolling_attempts"] = subset["attempt_value"].rolling(window=ROLLING_WINDOW, min_periods=1).mean()
        subset["rolling_runtime_ms"] = subset["runtime_ms_value"].rolling(window=ROLLING_WINDOW, min_periods=1).mean()

        out.append(subset)

    return pd.concat(out, ignore_index=True)


def plot_success(df: pd.DataFrame, scenario: str, out_file: Path):
    fig, ax = plt.subplots()

    for condition in CONDITION_ORDER:
        subset = df[df["condition_name"] == condition]
        ax.plot(
            subset["trial_index"],
            subset["cumulative_success_rate"] * 100.0,
            marker="o",
            linewidth=2,
            label=condition,
            color=CONDITION_COLORS[condition],
        )

    ax.set_title(f"{scenario.upper()} Early Runs (1-25): Cumulative Eventual Success Rate")
    ax.set_xlabel("Run Index")
    ax.set_ylabel("Cumulative Success Rate (%)")
    ax.set_ylim(0, 105)
    ax.set_xticks(range(EARLY_START, EARLY_END + 1, 2))
    ax.legend(title="Condition")

    fig.tight_layout()
    fig.savefig(out_file, dpi=300)
    plt.close(fig)


def plot_attempts(df: pd.DataFrame, scenario: str, out_file: Path):
    fig, ax = plt.subplots()

    for condition in CONDITION_ORDER:
        subset = df[df["condition_name"] == condition]

        ax.plot(
            subset["trial_index"],
            subset["rolling_attempts"],
            linewidth=2,
            label=condition,
            color=CONDITION_COLORS[condition],
        )
        ax.scatter(
            subset["trial_index"],
            subset["attempt_value"],
            s=18,
            color=CONDITION_COLORS[condition],
            alpha=0.35,
        )

    attempts_label = "Corrected Attempts" if scenario == "lever" else "Attempts"
    ax.set_title(f"{scenario.upper()} Early Runs (1-25): {attempts_label} (points) + Rolling Mean")
    ax.set_xlabel("Run Index")
    ax.set_ylabel(attempts_label)
    ax.set_xticks(range(EARLY_START, EARLY_END + 1, 2))
    ax.legend(title="Condition")

    fig.tight_layout()
    fig.savefig(out_file, dpi=300)
    plt.close(fig)


def plot_runtime(df: pd.DataFrame, scenario: str, out_file: Path):
    fig, ax = plt.subplots()

    for condition in CONDITION_ORDER:
        subset = df[df["condition_name"] == condition]

        ax.plot(
            subset["trial_index"],
            subset["rolling_runtime_ms"],
            linewidth=2,
            label=condition,
            color=CONDITION_COLORS[condition],
        )
        ax.scatter(
            subset["trial_index"],
            subset["runtime_ms_value"],
            s=18,
            color=CONDITION_COLORS[condition],
            alpha=0.35,
        )

    ax.set_title(f"{scenario.upper()} Early Runs (1-25): Runtime (points) + Rolling Mean")
    ax.set_xlabel("Run Index")
    ax.set_ylabel("Runtime (ms)")
    ax.set_xticks(range(EARLY_START, EARLY_END + 1, 2))
    ax.legend(title="Condition")

    fig.tight_layout()
    fig.savefig(out_file, dpi=300)
    plt.close(fig)


def plot_lever_first_attempt(df: pd.DataFrame, out_file: Path):
    fig, ax = plt.subplots()

    for condition in CONDITION_ORDER:
        subset = df[df["condition_name"] == condition]
        ax.plot(
            subset["trial_index"],
            subset["cumulative_first_attempt_rate"] * 100.0,
            marker="o",
            linewidth=2,
            label=condition,
            color=CONDITION_COLORS[condition],
        )

    ax.set_title("LEVER Early Runs (1-25): Cumulative First-Attempt Success Rate")
    ax.set_xlabel("Run Index")
    ax.set_ylabel("Cumulative First-Attempt Success Rate (%)")
    ax.set_ylim(0, 105)
    ax.set_xticks(range(EARLY_START, EARLY_END + 1, 2))
    ax.legend(title="Condition")

    fig.tight_layout()
    fig.savefig(out_file, dpi=300)
    plt.close(fig)


def write_data_files(df: pd.DataFrame, scenario_dir: Path, scenario: str):
    csv_path = scenario_dir / f"{scenario}_early_runs_1_25_chart_data.csv"
    json_path = scenario_dir / f"{scenario}_early_runs_1_25_chart_data.json"

    export_cols = [
        "scenario",
        "condition_name",
        "trial_index",
        "run_label",
        "eventual_success",
        "first_attempt_success",
        "attempts",
        "corrected_attempts",
        "runtime_ms",
        "attempt_value",
        "rolling_attempts",
        "runtime_ms_value",
        "rolling_runtime_ms",
        "cumulative_success_rate",
        "cumulative_first_attempt_rate",
    ]

    trimmed = df[[c for c in export_cols if c in df.columns]].copy()
    trimmed.to_csv(csv_path, index=False)
    json_path.write_text(trimmed.to_json(orient="records", indent=2), encoding="utf-8")

    return [csv_path, json_path]


def build_scenario_early_charts(scenario: str):
    out_dir = CHARTS_ROOT / scenario
    ensure_dir(out_dir)

    base_df = load_run_data(scenario)
    df = compute_derived_columns(base_df, scenario)

    written = []
    written.extend(write_data_files(df, out_dir, scenario))

    success_file = out_dir / f"{scenario}_early_success_runs_1_25.png"
    attempts_file = out_dir / f"{scenario}_early_attempts_runs_1_25.png"
    runtime_file = out_dir / f"{scenario}_early_runtime_runs_1_25.png"

    plot_success(df, scenario, success_file)
    plot_attempts(df, scenario, attempts_file)
    plot_runtime(df, scenario, runtime_file)

    written.extend([success_file, attempts_file, runtime_file])

    if scenario == "lever":
        lever_fa_file = out_dir / "lever_early_first_attempt_success_runs_1_25.png"
        plot_lever_first_attempt(df, lever_fa_file)
        written.append(lever_fa_file)

    return written


def main():
    ensure_dir(CHARTS_ROOT)

    written = []
    for scenario in ["lever", "maze", "key"]:
        written.extend(build_scenario_early_charts(scenario))

    manifest_path = CHARTS_ROOT / "early_chart_manifest.json"
    manifest_path.write_text(
        json.dumps([str(p.relative_to(REPO_ROOT)).replace("\\", "/") for p in written], indent=2),
        encoding="utf-8",
    )
    written.append(manifest_path)

    print(f"WROTE_COUNT={len(written)}")
    for p in written:
        print(f"WROTE={str(p.relative_to(REPO_ROOT)).replace('\\', '/')}")


if __name__ == "__main__":
    main()
