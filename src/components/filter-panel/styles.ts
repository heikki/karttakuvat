import { css } from 'lit';

export const styles = css`
  *,
  *::before,
  *::after {
    box-sizing: border-box;
  }
  :host {
    display: block;
    position: absolute;
    top: 10px;
    right: 10px;
    user-select: none;
    z-index: 1000;
    width: 220px;
    font-family:
      -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  }
  .wrapper {
    background: #2c2c2e;
    padding: 15px;
    border-radius: 10px;
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.5);
  }
  h2 {
    font-size: 16px;
    margin: 0 0 10px 0;
    color: #e5e5e7;
  }
  p {
    font-size: 13px;
    color: #98989d;
    margin: 4px 0;
  }
  .panel-header {
    cursor: pointer;
    user-select: none;
  }
  .panel-body {
    margin-top: 12px;
    border-top: 1px solid #3a3a3c;
    padding-top: 12px;
  }
  label {
    font-size: 12px;
    color: #98989d;
    display: block;
    margin-bottom: 4px;
  }
  select {
    width: 100%;
    padding: 6px 8px;
    background: #3a3a3c;
    color: #e5e5e7;
    border: 1px solid #48484a;
    border-radius: 6px;
    font-size: 13px;
    cursor: pointer;
    margin-bottom: 8px;
  }
  .map-type-buttons,
  .filter-buttons {
    display: flex;
    gap: 0;
    margin-bottom: 8px;
    border-radius: 6px;
    overflow: hidden;
    border: 1px solid #48484a;
  }
  .map-type-btn,
  .filter-btn {
    flex: 1;
    padding: 5px 0;
    border: none;
    border-right: 1px solid #48484a;
    background: #3a3a3c;
    color: #98989d;
    font-size: 11px;
    cursor: pointer;
    transition:
      background 0.15s,
      color 0.15s;
  }
  .map-type-btn:last-child,
  .filter-btn:last-child {
    border-right: none;
  }
  .map-type-btn:hover,
  .filter-btn:hover {
    background: #48484a;
  }
  .map-type-btn.active {
    background: #007aff;
    color: white;
  }
  .filter-btn.active {
    background: var(--btn-color, #007aff);
    color: white;
  }
  .view-buttons {
    display: flex;
    gap: 6px;
    margin-top: 12px;
    padding-top: 12px;
    border-top: 1px solid #3a3a3c;
  }
  .view-btn {
    flex: 1;
    padding: 5px 10px;
    border: 1px solid #48484a;
    border-radius: 6px;
    background: #3a3a3c;
    color: #e5e5e7;
    font-size: 12px;
    cursor: pointer;
  }
  .view-btn:hover {
    background: #48484a;
    border-color: #48484a;
  }
  .view-btn.active {
    background: #007aff;
    color: white;
    border-color: #007aff;
  }
  .edit-section {
    margin-top: 12px;
    padding-top: 12px;
    border-top: 1px solid #3a3a3c;
    font-size: 13px;
    color: #e5e5e7;
  }
  .count {
    font-weight: bold;
    color: #f59e0b;
  }
  .edit-buttons {
    display: flex;
    gap: 8px;
    margin-top: 8px;
  }
  .edit-buttons button {
    flex: 1;
    padding: 6px 10px;
    border: none;
    border-radius: 6px;
    font-size: 12px;
    cursor: pointer;
    background: #007aff;
    color: white;
  }
  .edit-buttons button:hover {
    opacity: 0.9;
  }
  .edit-buttons button.secondary {
    background: #3a3a3c;
    color: #e5e5e7;
  }
  .edit-buttons button.secondary:hover {
    background: #48484a;
  }
  .edit-buttons button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;
