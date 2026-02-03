# RagCraft Visualization Guide

This guide explains how to generate and export visualizations of your RagCraft performance metrics.

## Quick Start

1. **Run evaluations** to generate metrics:
   ```powershell
   npm run eval
   ```

2. **Generate visualizations**:
   ```powershell
   npm run visualize    # Interactive HTML with export buttons
   npm run plots        # Publication-quality PNG/PDF plots (requires Python)
   ```

## Visualization Options

### 1. Interactive HTML Visualization

**Command:** `npm run visualize`

**Output:** `rag/eval/visualization.html`

**Features:**
- Interactive Chart.js graphs
- Export individual charts as PNG
- Export entire report as PDF
- Summary statistics cards
- Comparison between Distilled and Raw modes

**Export Options:**
- Click "Export [Chart Name] (PNG)" buttons to download individual charts
- Click "Export All as PDF" (top-right) to download complete report

**Open:** Double-click `rag/eval/visualization.html` in your browser

### 2. Publication-Quality Python Plots

**Command:** `npm run plots`

**Requirements:**
```powershell
pip install -r requirements.txt
```

**Output:** `rag/eval/plots/` directory containing:
- `completion_time.png` and `.pdf` - Task completion time comparison
- `storage_size.png` and `.pdf` - Storage size comparison  
- `success_rate.png` and `.pdf` - Success rate comparison
- `combined_comparison.png` and `.pdf` - All three metrics in one figure

**Features:**
- High-resolution (300 DPI) images
- Publication-ready format
- Error bars showing standard deviation
- Value labels on bars
- Professional styling with seaborn theme

## Metrics Visualized

All visualizations show three key metrics:

1. **Task Completion Time** (seconds)
   - How long each scenario takes to complete
   - Comparison: Distilled vs Raw mode

2. **Storage Size** (KB)
   - Memory footprint of the vector store
   - Comparison: Distilled vs Raw mode

3. **Success Rate** (%)
   - Percentage of successful runs
   - Comparison: Distilled vs Raw mode

## Example Workflow

```powershell
# 1. Run all scenarios
npm run eval

# 2. View interactive visualizations
npm run visualize
# Then open rag/eval/visualization.html in browser

# 3. Generate publication plots
npm run plots
# Plots saved to rag/eval/plots/
```

## Troubleshooting

### HTML Export Not Working
- Ensure you have internet connection (CDN libraries required)
- Try right-clicking on chart and "Save image as..."

### Python Plots Not Working
- Install Python dependencies: `pip install -r requirements.txt`
- Ensure Python 3.7+ is installed
- Check that metrics files exist in `rag/eval/runs/`

### No Data to Visualize
- Run `npm run eval` first to generate metrics
- Check that `rag/eval/runs/` contains JSON files
- Ensure you're using "Enhanced" episode functions (they collect metrics)

## File Locations

- **Metrics Data:** `rag/eval/runs/*.json`
- **HTML Visualization:** `rag/eval/visualization.html`
- **Python Plots:** `rag/eval/plots/*.png` and `*.pdf`
- **Python Script:** `generate_plots.py`

