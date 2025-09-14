import { expect, test, describe, beforeEach, afterEach } from "vitest";
import { monitoringDB } from "./db";
import { tokenDB } from "../token/db";
import { getCanisterHealth, getTransactionMetrics, getAlerts, acknowledgeAlert } from "./monitoring_api";

describe("Monitoring API", () => {
  beforeEach(async () => {
    // Clean up test data
    await monitoringDB.exec`DELETE FROM monitoring_alerts WHERE canister_id LIKE 'test-%'`;
    await monitoringDB.exec`DELETE FROM canister_health WHERE canister_id LIKE 'test-%'`;
    await monitoringDB.exec`DELETE FROM transaction_metrics WHERE canister_id LIKE 'test-%'`;
    await monitoringDB.exec`DELETE FROM health_check_config WHERE canister_id LIKE 'test-%'`;
    await tokenDB.exec`DELETE FROM tokens WHERE symbol IN ('MTEST', 'ATEST')`;
  });

  afterEach(async () => {
    // Clean up test data
    await monitoringDB.exec`DELETE FROM monitoring_alerts WHERE canister_id LIKE 'test-%'`;
    await monitoringDB.exec`DELETE FROM canister_health WHERE canister_id LIKE 'test-%'`;
    await monitoringDB.exec`DELETE FROM transaction_metrics WHERE canister_id LIKE 'test-%'`;
    await monitoringDB.exec`DELETE FROM health_check_config WHERE canister_id LIKE 'test-%'`;
    await tokenDB.exec`DELETE FROM tokens WHERE symbol IN ('MTEST', 'ATEST')`;
  });

  test("should get canister health metrics", async () => {
    // Create test token
    const tokenResult = await tokenDB.queryRow<{ id: number }>`
      INSERT INTO tokens (token_name, symbol, total_supply, decimals, creator_principal, canister_id, status)
      VALUES ('Monitor Test Token', 'MTEST', 1000000, 8, 'test-principal', 'test-canister-1', 'deployed')
      RETURNING id
    `;

    const tokenId = tokenResult!.id;

    // Insert health data
    await monitoringDB.exec`
      INSERT INTO canister_health (
        canister_id, token_id, status, cycle_balance, memory_size, 
        controllers, response_time_ms, error_count, uptime_percentage
      ) VALUES (
        'test-canister-1', ${tokenId}, 'running', 5000000000000, 1048576,
        '{"test-principal"}', 250, 0, 99.5
      )
    `;

    const result = await getCanisterHealth({});

    expect(result.canisters).toBeDefined();
    expect(result.canisters.length).toBeGreaterThan(0);
    expect(result.summary).toBeDefined();
    expect(result.summary.totalCanisters).toBeGreaterThanOrEqual(1);

    const testCanister = result.canisters.find(c => c.canisterId === 'test-canister-1');
    expect(testCanister).toBeDefined();
    expect(testCanister?.status).toBe('running');
    expect(testCanister?.uptimePercentage).toBe(99.5);
  });

  test("should get transaction metrics", async () => {
    // Create test token
    const tokenResult = await tokenDB.queryRow<{ id: number }>`
      INSERT INTO tokens (token_name, symbol, total_supply, decimals, creator_principal, canister_id, status)
      VALUES ('Analytics Test Token', 'ATEST', 2000000, 8, 'test-principal', 'test-canister-2', 'deployed')
      RETURNING id
    `;

    const tokenId = tokenResult!.id;

    // Insert transaction metrics
    await monitoringDB.exec`
      INSERT INTO transaction_metrics (
        canister_id, token_id, total_transactions, successful_transactions,
        failed_transactions, average_response_time_ms
      ) VALUES (
        'test-canister-2', ${tokenId}, 150, 145, 5, 300
      )
    `;

    const result = await getTransactionMetrics({});

    expect(result.metrics).toBeDefined();
    expect(result.metrics.length).toBeGreaterThan(0);
    expect(result.summary).toBeDefined();

    const testMetrics = result.metrics.find(m => m.canisterId === 'test-canister-2');
    expect(testMetrics).toBeDefined();
    expect(testMetrics?.totalTransactions).toBe(150);
    expect(testMetrics?.successfulTransactions).toBe(145);
    expect(testMetrics?.failedTransactions).toBe(5);
    expect(testMetrics?.successRate).toBeCloseTo(96.67, 1);
  });

  test("should get monitoring alerts", async () => {
    // Create test token
    const tokenResult = await tokenDB.queryRow<{ id: number }>`
      INSERT INTO tokens (token_name, symbol, total_supply, decimals, creator_principal, canister_id, status)
      VALUES ('Alert Test Token', 'ATEST', 3000000, 8, 'test-principal', 'test-canister-3', 'deployed')
      RETURNING id
    `;

    const tokenId = tokenResult!.id;

    // Insert test alerts
    await monitoringDB.exec`
      INSERT INTO monitoring_alerts (
        canister_id, token_id, alert_type, severity, title, message
      ) VALUES (
        'test-canister-3', ${tokenId}, 'low_cycles', 'warning', 'Low Cycle Balance', 'Canister is running low on cycles'
      )
    `;

    await monitoringDB.exec`
      INSERT INTO monitoring_alerts (
        canister_id, token_id, alert_type, severity, title, message
      ) VALUES (
        'test-canister-3', ${tokenId}, 'critical_cycles', 'critical', 'Critical Cycle Balance', 'Canister critically low on cycles'
      )
    `;

    const result = await getAlerts({});

    expect(result.alerts).toBeDefined();
    expect(result.alerts.length).toBeGreaterThanOrEqual(2);
    expect(result.summary).toBeDefined();

    const warningAlert = result.alerts.find(a => a.severity === 'warning');
    const criticalAlert = result.alerts.find(a => a.severity === 'critical');

    expect(warningAlert).toBeDefined();
    expect(criticalAlert).toBeDefined();
    expect(warningAlert?.alertType).toBe('low_cycles');
    expect(criticalAlert?.alertType).toBe('critical_cycles');
  });

  test("should acknowledge alerts", async () => {
    // Create test token
    const tokenResult = await tokenDB.queryRow<{ id: number }>`
      INSERT INTO tokens (token_name, symbol, total_supply, decimals, creator_principal, canister_id, status)
      VALUES ('Ack Test Token', 'ATEST', 4000000, 8, 'test-principal', 'test-canister-4', 'deployed')
      RETURNING id
    `;

    const tokenId = tokenResult!.id;

    // Insert test alert
    const alertResult = await monitoringDB.queryRow<{ id: number }>`
      INSERT INTO monitoring_alerts (
        canister_id, token_id, alert_type, severity, title, message
      ) VALUES (
        'test-canister-4', ${tokenId}, 'high_response_time', 'warning', 'High Response Time', 'Response time is elevated'
      ) RETURNING id
    `;

    const alertId = alertResult!.id;

    // Acknowledge the alert
    const ackResult = await acknowledgeAlert({
      alertId,
      acknowledgedBy: 'test-user'
    });

    expect(ackResult.success).toBe(true);

    // Verify alert was acknowledged
    const updatedAlert = await monitoringDB.queryRow<{
      acknowledged: boolean;
      acknowledged_by: string;
    }>`
      SELECT acknowledged, acknowledged_by
      FROM monitoring_alerts
      WHERE id = ${alertId}
    `;

    expect(updatedAlert?.acknowledged).toBe(true);
    expect(updatedAlert?.acknowledged_by).toBe('test-user');
  });

  test("should filter alerts by severity", async () => {
    // Create test token
    const tokenResult = await tokenDB.queryRow<{ id: number }>`
      INSERT INTO tokens (token_name, symbol, total_supply, decimals, creator_principal, canister_id, status)
      VALUES ('Filter Test Token', 'FTEST', 5000000, 8, 'test-principal', 'test-canister-5', 'deployed')
      RETURNING id
    `;

    const tokenId = tokenResult!.id;

    // Insert alerts with different severities
    await monitoringDB.exec`
      INSERT INTO monitoring_alerts (
        canister_id, token_id, alert_type, severity, title, message
      ) VALUES 
        ('test-canister-5', ${tokenId}, 'info_alert', 'info', 'Info Alert', 'Information'),
        ('test-canister-5', ${tokenId}, 'warning_alert', 'warning', 'Warning Alert', 'Warning message'),
        ('test-canister-5', ${tokenId}, 'critical_alert', 'critical', 'Critical Alert', 'Critical issue')
    `;

    // Get only critical alerts
    const criticalResult = await getAlerts({ severity: 'critical' });
    const criticalAlerts = criticalResult.alerts.filter(a => a.canisterId === 'test-canister-5');
    expect(criticalAlerts.length).toBe(1);
    expect(criticalAlerts[0].severity).toBe('critical');

    // Get only warning alerts
    const warningResult = await getAlerts({ severity: 'warning' });
    const warningAlerts = warningResult.alerts.filter(a => a.canisterId === 'test-canister-5');
    expect(warningAlerts.length).toBe(1);
    expect(warningAlerts[0].severity).toBe('warning');
  });

  test("should filter health by canister ID", async () => {
    // Create test tokens
    const token1Result = await tokenDB.queryRow<{ id: number }>`
      INSERT INTO tokens (token_name, symbol, total_supply, decimals, creator_principal, canister_id, status)
      VALUES ('Health Test Token 1', 'HTT1', 1000000, 8, 'test-principal', 'test-health-1', 'deployed')
      RETURNING id
    `;

    const token2Result = await tokenDB.queryRow<{ id: number }>`
      INSERT INTO tokens (token_name, symbol, total_supply, decimals, creator_principal, canister_id, status)
      VALUES ('Health Test Token 2', 'HTT2', 2000000, 8, 'test-principal', 'test-health-2', 'deployed')
      RETURNING id
    `;

    const tokenId1 = token1Result!.id;
    const tokenId2 = token2Result!.id;

    // Insert health data for both canisters
    await monitoringDB.exec`
      INSERT INTO canister_health (
        canister_id, token_id, status, cycle_balance, memory_size, 
        controllers, response_time_ms, error_count, uptime_percentage
      ) VALUES 
        ('test-health-1', ${tokenId1}, 'running', 3000000000000, 1048576, '{"test-principal"}', 200, 0, 100),
        ('test-health-2', ${tokenId2}, 'running', 4000000000000, 2097152, '{"test-principal"}', 300, 1, 98.5)
    `;

    // Get health for specific canister
    const result = await getCanisterHealth({ canisterId: 'test-health-1' });

    expect(result.canisters.length).toBe(1);
    expect(result.canisters[0].canisterId).toBe('test-health-1');
    expect(result.canisters[0].symbol).toBe('HTT1');
  });

  test("should handle pagination", async () => {
    // Create test token
    const tokenResult = await tokenDB.queryRow<{ id: number }>`
      INSERT INTO tokens (token_name, symbol, total_supply, decimals, creator_principal, canister_id, status)
      VALUES ('Pagination Test Token', 'PTEST', 1000000, 8, 'test-principal', 'test-pagination', 'deployed')
      RETURNING id
    `;

    const tokenId = tokenResult!.id;

    // Insert multiple alerts
    for (let i = 0; i < 15; i++) {
      await monitoringDB.exec`
        INSERT INTO monitoring_alerts (
          canister_id, token_id, alert_type, severity, title, message
        ) VALUES (
          'test-pagination', ${tokenId}, 'test_alert', 'info', ${'Test Alert ' + (i + 1)}, ${'Message ' + (i + 1)}
        )
      `;
    }

    // Test pagination
    const page1 = await getAlerts({ limit: 5, offset: 0 });
    const page2 = await getAlerts({ limit: 5, offset: 5 });

    const page1Alerts = page1.alerts.filter(a => a.canisterId === 'test-pagination');
    const page2Alerts = page2.alerts.filter(a => a.canisterId === 'test-pagination');

    expect(page1Alerts.length).toBeLessThanOrEqual(5);
    expect(page2Alerts.length).toBeLessThanOrEqual(5);

    // Ensure no duplicates between pages
    const page1Ids = page1Alerts.map(a => a.id);
    const page2Ids = page2Alerts.map(a => a.id);
    const intersection = page1Ids.filter(id => page2Ids.includes(id));
    expect(intersection.length).toBe(0);
  });
});
