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

WINDOW_ORDER = ["1-25", "26-50", "51-75", "76-100", "101-125", "126-150", "151-175", "176-200"]

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


def pct(v):
    if pd.isna(v):
        return None
    return float(v) * 100.0


def load_scenario_data(scenario: str):
    scenario_dir = ANALYSIS_ROOT / scenario
    if scenario == "lever":
        cond_file = scenario_dir / "lever_condition_summary_corrected.csv"
        win_file = scenario_dir / "lever_window_summary_corrected.csv"
    else:
        cond_file = scenario_dir / f"{scenario}_condition_summary.csv"
        win_file = scenario_dir / f"{scenario}_window_summary.csv"

    cond_df = pd.read_csv(cond_file)
    win_df = pd.read_csv(win_file)

    cond_df["condition_name"] = pd.Categorical(cond_df["condition_name"], CONDITION_ORDER, ordered=True)
    cond_df = cond_df.sort_values(["condition_name"]).reset_index(drop=True)

    win_df["condition_name"] = pd.Categorical(win_df["condition_name"], CONDITION_ORDER, ordered=True)
    win_df["window_label"] = pd.Categorical(win_df["window_label"], WINDOW_ORDER, ordered=True)
    win_df = win_df.sort_values(["condition_name", "window_label"]).reset_index(drop=True)

    return cond_df, win_df


def write_chart_data(out_dir: Path, scenario: str, cond_df: pd.DataFrame, win_df: pd.DataFrame):
    ensure_dir(out_dir)
    cond_out_csv = out_dir / f"{scenario}_condition_chart_data.csv"
    cond_out_json = out_dir / f"{scenario}_condition_chart_data.json"
    win_out_csv = out_dir / f"{scenario}_window_chart_data.csv"
    win_out_json = out_dir / f"{scenario}_window_chart_data.json"

    cond_df.to_csv(cond_out_csv, index=False)
    win_df.to_csv(win_out_csv, index=False)

    cond_out_json.write_text(cond_df.to_json(orient="records", indent=2), encoding="utf-8")
    win_out_json.write_text(win_df.to_json(orient="records", indent=2), encoding="utf-8")

    return [cond_out_csv, cond_out_json, win_out_csv, win_out_json]


def plot_bar_metric(cond_df: pd.DataFrame, scenario: str, metric_col: str, title: str, ylabel: str, out_file: Path, to_percent=False):
    fig, ax = plt.subplots()

    data = cond_df[["condition_name", metric_col]].copy()
    if to_percent:
        data[metric_col] = data[metric_col].apply(pct)

    colors = [CONDITION_COLORS[str(c)] for c in data["condition_name"]]
    x = range(len(data))
    bars = ax.bar(x, data[metric_col], color=colors, edgecolor="#333333", linewidth=0.6)

    ax.set_xticks(list(x))
    ax.set_xticklabels(data["condition_name"].astype(str), rotation=0)
    ax.set_title(title)
    ax.set_xlabel("Condition")
    ax.set_ylabel(ylabel)

    for i, bar in enumerate(bars):
        h = bar.get_height()
        if pd.isna(h):
            continue
        label = f"{h:.1f}%" if to_percent else f"{h:.2f}"
        ax.text(bar.get_x() + bar.get_width() / 2, h, label, ha="center", va="bottom", fontsize=9)

    fig.tight_layout()
    fig.savefig(out_file, dpi=300)
    plt.close(fig)


def plot_window_lines(win_df: pd.DataFrame, scenario: str, metric_col: str, title: str, ylabel: str, out_file: Path, to_percent=False):
    fig, ax = plt.subplots()

    for condition in CONDITION_ORDER:
        subset = win_df[win_df["condition_name"] == condition].copy()
        y = subset[metric_col]
        if to_percent:
            y = y.apply(pct)
        ax.plot(
            subset["window_label"].astype(str),
            y,
            marker="o",
            linewidth=2,
            label=condition,
            color=CONDITION_COLORS[condition],
        )

    ax.set_title(title)
    ax.set_xlabel("Trial Window")
    ax.set_ylabel(ylabel)
    ax.legend(title="Condition")
    ax.tick_params(axis="x", rotation=30)

    fig.tight_layout()
    fig.savefig(out_file, dpi=300)
    plt.close(fig)


def build_scenario_charts(scenario: str):
    cond_df, win_df = load_scenario_data(scenario)
    out_dir = CHARTS_ROOT / scenario
    ensure_dir(out_dir)

    written = []
    written.extend(write_chart_data(out_dir, scenario, cond_df, win_df))

    # Condition-level thesis charts
    success_file = out_dir / f"{scenario}_success_rate_by_condition.png"
    attempts_file = out_dir / f"{scenario}_attempts_by_condition.png"
    runtime_file = out_dir / f"{scenario}_runtime_by_condition.png"

    plot_bar_metric(
        cond_df,
        scenario,
        "eventual_success_rate",
        f"{scenario.upper()} Eventual Success Rate by Condition",
        "Success Rate (%)",
        success_file,
        to_percent=True,
    )

    attempts_metric = "mean_corrected_attempts" if scenario == "lever" else "mean_attempts"
    attempts_label = "Mean Corrected Attempts" if scenario == "lever" else "Mean Attempts"

    plot_bar_metric(
        cond_df,
        scenario,
        attempts_metric,
        f"{scenario.upper()} Attempts by Condition",
        attempts_label,
        attempts_file,
        to_percent=False,
    )

    plot_bar_metric(
        cond_df,
        scenario,
        "mean_runtime",
        f"{scenario.upper()} Runtime by Condition",
        "Mean Runtime (ms)",
        runtime_file,
        to_percent=False,
    )

    written.extend([success_file, attempts_file, runtime_file])

    # Window-level thesis charts
    win_success_file = out_dir / f"{scenario}_success_rate_over_windows.png"
    win_attempts_file = out_dir / f"{scenario}_attempts_over_windows.png"
    win_runtime_file = out_dir / f"{scenario}_runtime_over_windows.png"

    plot_window_lines(
        win_df,
        scenario,
        "eventual_success_rate",
        f"{scenario.upper()} Eventual Success Rate over Trial Windows",
        "Success Rate (%)",
        win_success_file,
        to_percent=True,
    )

    win_attempts_metric = "mean_corrected_attempts" if scenario == "lever" else "mean_attempts"
    win_attempts_label = "Mean Corrected Attempts" if scenario == "lever" else "Mean Attempts"

    plot_window_lines(
        win_df,
        scenario,
        win_attempts_metric,
        f"{scenario.upper()} Attempts over Trial Windows",
        win_attempts_label,
        win_attempts_file,
        to_percent=False,
    )

    plot_window_lines(
        win_df,
        scenario,
        "mean_runtime",
        f"{scenario.upper()} Runtime over Trial Windows",
        "Mean Runtime (ms)",
        win_runtime_file,
        to_percent=False,
    )

    written.extend([win_success_file, win_attempts_file, win_runtime_file])

    # Lever-specific first-attempt charts
    if scenario == "lever":
        fa_cond_file = out_dir / "lever_first_attempt_success_by_condition.png"
        fa_win_file = out_dir / "lever_first_attempt_success_over_windows.png"

        plot_bar_metric(
            cond_df,
            scenario,
            "first_attempt_success_rate",
            "LEVER First-Attempt Success Rate by Condition",
            "First-Attempt Success Rate (%)",
            fa_cond_file,
            to_percent=True,
        )

        plot_window_lines(
            win_df,
            scenario,
            "first_attempt_success_rate",
            "LEVER First-Attempt Success Rate over Trial Windows",
            "First-Attempt Success Rate (%)",
            fa_win_file,
            to_percent=True,
        )

        written.extend([fa_cond_file, fa_win_file])

    return written


def main():
    ensure_dir(CHARTS_ROOT)
    all_written = []
    for scenario in ["lever", "maze", "key"]:
        all_written.extend(build_scenario_charts(scenario))

    manifest = CHARTS_ROOT / "chart_manifest.json"
    manifest.write_text(
        json.dumps([str(p.relative_to(REPO_ROOT)).replace("\\\\", "/") for p in all_written], indent=2),
        encoding="utf-8",
    )

    print(f"WROTE_COUNT={len(all_written)}")
    for p in all_written:
        print(f"WROTE={str(p.relative_to(REPO_ROOT)).replace('\\\\', '/')}")
    print(f"WROTE={str(manifest.relative_to(REPO_ROOT)).replace('\\\\', '/')}")


if __name__ == "__main__":
    main()
