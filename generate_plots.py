#!/usr/bin/env python3


import json
import os
import glob
from pathlib import Path
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
import numpy as np
from collections import defaultdict

# Set style for publication-quality plots
plt.style.use('seaborn-v0_8-darkgrid')
plt.rcParams['figure.figsize'] = (12, 8)
plt.rcParams['font.size'] = 12
plt.rcParams['axes.labelsize'] = 14
plt.rcParams['axes.titlesize'] = 16
plt.rcParams['xtick.labelsize'] = 12
plt.rcParams['ytick.labelsize'] = 12
plt.rcParams['legend.fontsize'] = 12
plt.rcParams['figure.titlesize'] = 18

def load_metrics_data(metrics_dir):
    """Load all metrics JSON files."""
    metrics = defaultdict(lambda: {'distilled': [], 'raw': []})
    
    for file_path in glob.glob(os.path.join(metrics_dir, '*.json')):
        try:
            with open(file_path, 'r') as f:
                data = json.load(f)
                scenario_id = data.get('scenarioId')
                mode = data.get('mode')
                summary = data.get('summary', {})
                
                if scenario_id and mode and summary:
                    metrics[scenario_id][mode].append({
                        'completion_time': summary.get('totalDurationMs', 0) / 1000,  # Convert to seconds
                        'storage_size': summary.get('finalStoreSize', 0) / 1024,  # Convert to KB
                        'success': summary.get('taskSuccess', False),
                        'attempts': summary.get('attemptsToSolve', 0)
                    })
        except Exception as e:
            print(f"Warning: Failed to load {file_path}: {e}")
    
    return dict(metrics)

def calculate_stats(runs):
    """Calculate statistics from a list of runs."""
    if not runs:
        return {
            'mean': 0,
            'std': 0,
            'values': []
        }
    
    values = [r['completion_time'] for r in runs]
    return {
        'mean': np.mean(values),
        'std': np.std(values),
        'values': values
    }

def plot_completion_time(metrics_data, output_dir):
    """Plot task completion time comparison."""
    fig, ax = plt.subplots(figsize=(10, 6))
    
    scenarios = list(metrics_data.keys())
    x = np.arange(len(scenarios))
    width = 0.35
    
    distilled_means = []
    raw_means = []
    distilled_stds = []
    raw_stds = []
    
    for scenario in scenarios:
        distilled_stats = calculate_stats(metrics_data[scenario]['distilled'])
        raw_stats = calculate_stats(metrics_data[scenario]['raw'])
        
        distilled_means.append(distilled_stats['mean'])
        raw_means.append(raw_stats['mean'])
        distilled_stds.append(distilled_stats['std'])
        raw_stds.append(raw_stats['std'])
    
    bars1 = ax.bar(x - width/2, distilled_means, width, yerr=distilled_stds,
                   label='Distilled', color='#4CAF50', alpha=0.8, capsize=5)
    bars2 = ax.bar(x + width/2, raw_means, width, yerr=raw_stds,
                   label='Raw', color='#FF9800', alpha=0.8, capsize=5)
    
    ax.set_xlabel('Scenario', fontweight='bold')
    ax.set_ylabel('Completion Time (seconds)', fontweight='bold')
    ax.set_title('Task Completion Time Comparison', fontweight='bold', pad=20)
    ax.set_xticks(x)
    ax.set_xticklabels([s.replace('_', ' ').title() for s in scenarios])
    ax.legend()
    ax.grid(axis='y', alpha=0.3)
    
    # Add value labels on bars
    for bars in [bars1, bars2]:
        for bar in bars:
            height = bar.get_height()
            ax.text(bar.get_x() + bar.get_width()/2., height,
                   f'{height:.2f}s',
                   ha='center', va='bottom', fontsize=10)
    
    plt.tight_layout()
    plt.savefig(os.path.join(output_dir, 'completion_time.png'), dpi=300, bbox_inches='tight')
    plt.savefig(os.path.join(output_dir, 'completion_time.pdf'), bbox_inches='tight')
    print(f"Saved: {os.path.join(output_dir, 'completion_time.png')}")
    plt.close()

def plot_storage_size(metrics_data, output_dir):
    """Plot storage size comparison."""
    fig, ax = plt.subplots(figsize=(10, 6))
    
    scenarios = list(metrics_data.keys())
    x = np.arange(len(scenarios))
    width = 0.35
    
    distilled_means = []
    raw_means = []
    distilled_stds = []
    raw_stds = []
    
    for scenario in scenarios:
        distilled_values = [r['storage_size'] for r in metrics_data[scenario]['distilled']]
        raw_values = [r['storage_size'] for r in metrics_data[scenario]['raw']]
        
        distilled_means.append(np.mean(distilled_values) if distilled_values else 0)
        raw_means.append(np.mean(raw_values) if raw_values else 0)
        distilled_stds.append(np.std(distilled_values) if distilled_values else 0)
        raw_stds.append(np.std(raw_values) if raw_values else 0)
    
    bars1 = ax.bar(x - width/2, distilled_means, width, yerr=distilled_stds,
                   label='Distilled', color='#2196F3', alpha=0.8, capsize=5)
    bars2 = ax.bar(x + width/2, raw_means, width, yerr=raw_stds,
                   label='Raw', color='#FF9800', alpha=0.8, capsize=5)
    
    ax.set_xlabel('Scenario', fontweight='bold')
    ax.set_ylabel('Storage Size (KB)', fontweight='bold')
    ax.set_title('Storage Size Comparison', fontweight='bold', pad=20)
    ax.set_xticks(x)
    ax.set_xticklabels([s.replace('_', ' ').title() for s in scenarios])
    ax.legend()
    ax.grid(axis='y', alpha=0.3)
    
    # Add value labels on bars
    for bars in [bars1, bars2]:
        for bar in bars:
            height = bar.get_height()
            ax.text(bar.get_x() + bar.get_width()/2., height,
                   f'{height:.1f} KB',
                   ha='center', va='bottom', fontsize=10)
    
    plt.tight_layout()
    plt.savefig(os.path.join(output_dir, 'storage_size.png'), dpi=300, bbox_inches='tight')
    plt.savefig(os.path.join(output_dir, 'storage_size.pdf'), bbox_inches='tight')
    print(f"Saved: {os.path.join(output_dir, 'storage_size.png')}")
    plt.close()

def plot_success_rate(metrics_data, output_dir):
    """Plot success rate comparison."""
    fig, ax = plt.subplots(figsize=(10, 6))
    
    scenarios = list(metrics_data.keys())
    x = np.arange(len(scenarios))
    width = 0.35
    
    distilled_rates = []
    raw_rates = []
    
    for scenario in scenarios:
        distilled_runs = metrics_data[scenario]['distilled']
        raw_runs = metrics_data[scenario]['raw']
        
        distilled_success = sum(1 for r in distilled_runs if r['success'])
        raw_success = sum(1 for r in raw_runs if r['success'])
        
        distilled_rate = (distilled_success / len(distilled_runs) * 100) if distilled_runs else 0
        raw_rate = (raw_success / len(raw_runs) * 100) if raw_runs else 0
        
        distilled_rates.append(distilled_rate)
        raw_rates.append(raw_rate)
    
    bars1 = ax.bar(x - width/2, distilled_rates, width,
                   label='Distilled', color='#4CAF50', alpha=0.8)
    bars2 = ax.bar(x + width/2, raw_rates, width,
                   label='Raw', color='#FF9800', alpha=0.8)
    
    ax.set_xlabel('Scenario', fontweight='bold')
    ax.set_ylabel('Success Rate (%)', fontweight='bold')
    ax.set_title('Success Rate Comparison', fontweight='bold', pad=20)
    ax.set_xticks(x)
    ax.set_xticklabels([s.replace('_', ' ').title() for s in scenarios])
    ax.set_ylim(0, 105)
    ax.legend()
    ax.grid(axis='y', alpha=0.3)
    
    # Add value labels on bars
    for bars in [bars1, bars2]:
        for bar in bars:
            height = bar.get_height()
            ax.text(bar.get_x() + bar.get_width()/2., height,
                   f'{height:.1f}%',
                   ha='center', va='bottom', fontsize=10)
    
    plt.tight_layout()
    plt.savefig(os.path.join(output_dir, 'success_rate.png'), dpi=300, bbox_inches='tight')
    plt.savefig(os.path.join(output_dir, 'success_rate.pdf'), bbox_inches='tight')
    print(f"Saved: {os.path.join(output_dir, 'success_rate.png')}")
    plt.close()

def plot_combined_comparison(metrics_data, output_dir):
    """Create a combined figure with all three metrics."""
    fig, axes = plt.subplots(1, 3, figsize=(18, 6))
    
    scenarios = list(metrics_data.keys())
    x = np.arange(len(scenarios))
    width = 0.35
    
    # Completion Time
    ax1 = axes[0]
    distilled_ct = []
    raw_ct = []
    for scenario in scenarios:
        distilled_stats = calculate_stats(metrics_data[scenario]['distilled'])
        raw_stats = calculate_stats(metrics_data[scenario]['raw'])
        distilled_ct.append(distilled_stats['mean'])
        raw_ct.append(raw_stats['mean'])
    
    ax1.bar(x - width/2, distilled_ct, width, label='Distilled', color='#4CAF50', alpha=0.8)
    ax1.bar(x + width/2, raw_ct, width, label='Raw', color='#FF9800', alpha=0.8)
    ax1.set_xlabel('Scenario', fontweight='bold')
    ax1.set_ylabel('Time (seconds)', fontweight='bold')
    ax1.set_title('Completion Time', fontweight='bold')
    ax1.set_xticks(x)
    ax1.set_xticklabels([s.replace('_', ' ').title() for s in scenarios], rotation=15, ha='right')
    ax1.legend()
    ax1.grid(axis='y', alpha=0.3)
    
    # Storage Size
    ax2 = axes[1]
    distilled_ss = []
    raw_ss = []
    for scenario in scenarios:
        distilled_values = [r['storage_size'] for r in metrics_data[scenario]['distilled']]
        raw_values = [r['storage_size'] for r in metrics_data[scenario]['raw']]
        distilled_ss.append(np.mean(distilled_values) if distilled_values else 0)
        raw_ss.append(np.mean(raw_values) if raw_values else 0)
    
    ax2.bar(x - width/2, distilled_ss, width, label='Distilled', color='#2196F3', alpha=0.8)
    ax2.bar(x + width/2, raw_ss, width, label='Raw', color='#FF9800', alpha=0.8)
    ax2.set_xlabel('Scenario', fontweight='bold')
    ax2.set_ylabel('Size (KB)', fontweight='bold')
    ax2.set_title('Storage Size', fontweight='bold')
    ax2.set_xticks(x)
    ax2.set_xticklabels([s.replace('_', ' ').title() for s in scenarios], rotation=15, ha='right')
    ax2.legend()
    ax2.grid(axis='y', alpha=0.3)
    
    # Success Rate
    ax3 = axes[2]
    distilled_sr = []
    raw_sr = []
    for scenario in scenarios:
        distilled_runs = metrics_data[scenario]['distilled']
        raw_runs = metrics_data[scenario]['raw']
        distilled_success = sum(1 for r in distilled_runs if r['success'])
        raw_success = sum(1 for r in raw_runs if r['success'])
        distilled_sr.append((distilled_success / len(distilled_runs) * 100) if distilled_runs else 0)
        raw_sr.append((raw_success / len(raw_runs) * 100) if raw_runs else 0)
    
    ax3.bar(x - width/2, distilled_sr, width, label='Distilled', color='#4CAF50', alpha=0.8)
    ax3.bar(x + width/2, raw_sr, width, label='Raw', color='#FF9800', alpha=0.8)
    ax3.set_xlabel('Scenario', fontweight='bold')
    ax3.set_ylabel('Rate (%)', fontweight='bold')
    ax3.set_title('Success Rate', fontweight='bold')
    ax3.set_xticks(x)
    ax3.set_xticklabels([s.replace('_', ' ').title() for s in scenarios], rotation=15, ha='right')
    ax3.set_ylim(0, 105)
    ax3.legend()
    ax3.grid(axis='y', alpha=0.3)
    
    plt.suptitle('RagCraft Performance Metrics Comparison', fontsize=18, fontweight='bold', y=1.02)
    plt.tight_layout()
    plt.savefig(os.path.join(output_dir, 'combined_comparison.png'), dpi=300, bbox_inches='tight')
    plt.savefig(os.path.join(output_dir, 'combined_comparison.pdf'), bbox_inches='tight')
    print(f"Saved: {os.path.join(output_dir, 'combined_comparison.png')}")
    plt.close()

def main():
    # Get script directory
    script_dir = Path(__file__).parent
    metrics_dir = script_dir / 'rag' / 'eval' / 'runs'
    output_dir = script_dir / 'rag' / 'eval' / 'plots'
    
    # Create output directory
    output_dir.mkdir(parents=True, exist_ok=True)
    
    if not metrics_dir.exists():
        print(f"Error: Metrics directory not found: {metrics_dir}")
        return
    
    print("Loading metrics data...")
    metrics_data = load_metrics_data(str(metrics_dir))
    
    if not metrics_data:
        print("No metrics data found. Run 'npm run eval' first.")
        return
    
    print(f"Found data for {len(metrics_data)} scenario(s): {', '.join(metrics_data.keys())}")
    print("\nGenerating plots...")
    
    plot_completion_time(metrics_data, str(output_dir))
    plot_storage_size(metrics_data, str(output_dir))
    plot_success_rate(metrics_data, str(output_dir))
    plot_combined_comparison(metrics_data, str(output_dir))
    
    print(f"\nAll plots saved to: {output_dir}")
    print("Formats: PNG (300 DPI) and PDF")

if __name__ == '__main__':
    main()

