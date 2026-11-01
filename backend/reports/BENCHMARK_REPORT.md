# JalNetra / NirX Backend ML Benchmark & Calibration Report
**Generated:** 2026-10-31T23:47:24Z  
**Evaluation Split:** Scenario-stratified, zero cross-scenario data leakage.
---
## 1. Soft Fusion & Probability Calibration
### Probability Calibration (Detector RF)
| Metric | Before Calibration (Raw RF) | After Calibration (Calibrated RF) | Relative Reduction |
| :--- | :--- | :--- | :--- |
| **Log-Loss** | 0.27495 | 0.27207 | **1.05%** |
| **Brier Score** | 0.08602 | 0.08393 | **2.44%** |

### Learned Soft Fusion Parameters (Log-Odds Space)
* **w_RF (Calibrated RF weight):** `0.76163`
* **w_phys (Physics scaled drop weight):** `0.77932`
* **w_iso (Isolation Forest score weight):** `0.01724`
* **w_0 (Intercept):** `-0.30179`
* **Test Fused Accuracy:** `85.34%`
* **Test Fused Brier Score:** `0.0953`
* **Test Fused Log-Loss:** `0.2947`

## 2. Localizer Clean Evaluation (No Data Leakage)
Previously, the localizer achieved a reported 100% Top-3 accuracy because it was evaluated on the training set (data leakage). When re-evaluated on a clean, held-out test split of scenarios:

| Split | Scenarios Evaluated | Top-1 Accuracy | Top-3 Accuracy |
| :--- | :--- | :--- | :--- |
| **Validation Split** | 77 leak scenarios | **9.09%** | **32.47%** |
| **Test Split** | 86 leak scenarios | **11.63%** | **32.56%** |

### Scenarios per Node Statistics
* Total Distinct Junction Classes: **92**
* Min scenarios per node: **1**
* Max scenarios per node: **9**
* Mean scenarios per node: **4.35**
* Nodes with 1 scenario: **10**
* Nodes with 2 scenarios: **9**
* Nodes with >= 3 scenarios: **73**

## 3. Depth Sweep Chart [4, 6, 8, 10, 12, 16]
| Max Depth | Detector Val Acc | Detector Val Log-Loss | Localizer Val Top-1 | Localizer Val Top-3 | Sizer Val R^2 | Sizer Val MAE (L/h) |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **4** | 78.50% | 0.3605 | 9.09% | 20.78% | 0.4354 | 97,433 |
| **6** | 83.18% | 0.3355 | 6.49% | 27.27% | 0.4163 | 96,790 |
| **8** | 83.18% | 0.3370 | 10.39% | 25.97% | 0.4105 | 96,299 |
| **10** | 81.31% | 0.3358 | 10.39% | 28.57% | 0.3858 | 97,734 |
| **12** | 81.31% | 0.3392 | 6.49% | 25.97% | 0.4090 | 94,906 |
| **16** | 84.11% | 0.3368 | 12.99% | 29.87% | 0.4066 | 95,414 |

**Optimal Depths Selected by Validation:** Detector: `16`, Localizer: `16`, Sizer: `4`

## 4. Sensor Pruning Curve (Accuracy vs. Number of Sensors)
| Active Sensors | Val Accuracy | Test Accuracy | Retained Importance |
| :--- | :--- | :--- | :--- |
| **12 sensors** | 80.37% | 85.34% | 100.0% |
| **11 sensors** | 82.24% | 86.21% | 96.78% |
| **10 sensors** | 81.31% | 86.21% | 92.38% |
| **9 sensors** | 85.98% | 87.07% | 87.86% |
| **8 sensors** | 83.18% | 86.21% | 82.49% |
| **7 sensors** | 85.05% | 87.07% | 76.61% |
| **6 sensors** | 84.11% | 88.79% | 68.46% |
| **5 sensors** | 84.11% | 88.79% | 58.58% |
| **4 sensors** | 81.31% | 87.07% | 48.52% |
| **3 sensors** | 72.90% | 74.14% | 38.0% |
| **2 sensors** | 74.77% | 75.00% | 27.31% |
| **1 sensors** | 68.22% | 77.59% | 14.37% |

## 5. False Alarm Rate (FAR) on No-Leak Scenarios
| Noise Std Dev | Tested Samples | FAR (Alert Threshold = 0.50) | FAR (Alert Threshold = 0.70) | Mean Fused Probability |
| :--- | :--- | :--- | :--- | :--- |
| **0.2 m** | 1000 | **0.90%** | **0.10%** | `0.1439` |
| **0.5 m** | 1000 | **26.10%** | **9.40%** | `0.3557` |
| **1.0 m** | 1000 | **61.70%** | **30.60%** | `0.5592` |
