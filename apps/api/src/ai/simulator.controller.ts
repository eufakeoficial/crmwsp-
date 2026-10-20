import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post, Put, Req, UseGuards } from "@nestjs/common";
import {
  AppError,
  NotFoundError,
  PlanLimitExceededError,
  aiScenarioInputSchema,
  runScenariosRequestSchema,
  simulateRequestSchema,
  type AiScenario,
  type AiScenarioExpectation,
  type AiScenarioList,
  type RunScenariosResponse,
  type ScenarioRunResult,
  type SimulationResult,
} from "@crmwsp/contracts";
import { aiScenarios, asc, eq, inArray, isUuid, type AiScenarioRow } from "@crmwsp/db";
import { DEFAULT_AI_SCENARIOS, checkExpectations } from "@crmwsp/domain";
import { CurrentTenantDb, Roles } from "../auth/decorators.js";
import { TenantGuard } from "../auth/tenant.guard.js";
import type { HttpRequest } from "../common/http.js";
import { parseOrThrow } from "../common/zod.js";
import type { TenantDb } from "../db/tenant-db.js";
import { writeAudit } from "../inbox/audit.js";
import { AiBudgetExceededError, SimulatorService } from "./simulator.service.js";

const MAX_SCENARIOS = 50;

function toDto(r: AiScenarioRow): AiScenario {
  return {
    id: r.id,
    name: r.name,
    messages: r.messages,
    expectations: r.expectations as AiScenarioExpectation[],
    isDefault: r.isDefault,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

function failureOf(err: unknown): string {
  if (err instanceof AiBudgetExceededError) return "budget_exceeded";
  if (err instanceof PlanLimitExceededError) return "plan_limit_reached";
  if (err instanceof AppError) return err.message.slice(0, 200);
  return "simulation_failed";
}

/** F6 conversation simulator: dry-run turns and the scenario regression suite (owner/admin). */
@Controller("ai")
@UseGuards(TenantGuard)
export class SimulatorController {
  constructor(@Inject(SimulatorService) private readonly simulator: SimulatorService) {}

  @Post("simulate")
  @HttpCode(200)
  @Roles("owner", "admin")
  simulate(@CurrentTenantDb() db: TenantDb, @Body() body: unknown): Promise<SimulationResult> {
    return this.simulator.simulate(db, parseOrThrow(simulateRequestSchema, body));
  }

  @Get("scenarios")
  @Roles("owner", "admin")
  async list(@CurrentTenantDb() db: TenantDb): Promise<AiScenarioList> {
    const rows = await db.run((tx) => tx.select().from(aiScenarios).orderBy(asc(aiScenarios.createdAt), asc(aiScenarios.id)));
    return { items: rows.map(toDto) };
  }

  @Post("scenarios")
  @Roles("owner", "admin")
  async create(@CurrentTenantDb() db: TenantDb, @Body() body: unknown, @Req() req: HttpRequest): Promise<AiScenario> {
    const input = parseOrThrow(aiScenarioInputSchema, body);
    return db.run(async (tx) => {
      const [row] = await tx.insert(aiScenarios).values({ tenantId: db.tenantId, ...input }).returning();
      if (!row) throw new Error("insert returned no row");
      await writeAudit(tx, { tenantId: db.tenantId, userId: db.userId, entity: "ai_scenario", entityId: row.id, action: "ai_scenario.created", ip: req.ip });
      return toDto(row);
    });
  }

  /** Installs the 5 default scenarios (services businesses, Spanish). Idempotent by name. */
  @Post("scenarios/defaults")
  @HttpCode(200)
  @Roles("owner", "admin")
  async installDefaults(@CurrentTenantDb() db: TenantDb): Promise<AiScenarioList> {
    return db.run(async (tx) => {
      const existing = new Set((await tx.select({ name: aiScenarios.name }).from(aiScenarios)).map((r) => r.name));
      const missing = DEFAULT_AI_SCENARIOS.filter((s) => !existing.has(s.name));
      if (missing.length > 0) {
        await tx.insert(aiScenarios).values(missing.map((s) => ({ tenantId: db.tenantId, ...s, messages: [...s.messages], expectations: [...s.expectations], isDefault: true })));
      }
      const rows = await tx.select().from(aiScenarios).orderBy(asc(aiScenarios.createdAt), asc(aiScenarios.id));
      return { items: rows.map(toDto) };
    });
  }

  @Put("scenarios/:id")
  @Roles("owner", "admin")
  async update(@CurrentTenantDb() db: TenantDb, @Param("id") id: string, @Body() body: unknown, @Req() req: HttpRequest): Promise<AiScenario> {
    if (!isUuid(id)) throw new NotFoundError("Scenario not found");
    const input = parseOrThrow(aiScenarioInputSchema, body);
    return db.run(async (tx) => {
      const [row] = await tx.update(aiScenarios).set({ ...input, updatedAt: new Date() }).where(eq(aiScenarios.id, id)).returning();
      if (!row) throw new NotFoundError("Scenario not found");
      await writeAudit(tx, { tenantId: db.tenantId, userId: db.userId, entity: "ai_scenario", entityId: id, action: "ai_scenario.updated", ip: req.ip });
      return toDto(row);
    });
  }

  @Delete("scenarios/:id")
  @HttpCode(204)
  @Roles("owner", "admin")
  async remove(@CurrentTenantDb() db: TenantDb, @Param("id") id: string, @Req() req: HttpRequest): Promise<void> {
    if (!isUuid(id)) throw new NotFoundError("Scenario not found");
    await db.run(async (tx) => {
      const [row] = await tx.delete(aiScenarios).where(eq(aiScenarios.id, id)).returning({ id: aiScenarios.id });
      if (!row) throw new NotFoundError("Scenario not found");
      await writeAudit(tx, { tenantId: db.tenantId, userId: db.userId, entity: "ai_scenario", entityId: id, action: "ai_scenario.deleted", ip: req.ip });
    });
  }

  /** Runs scenarios sequentially; each one is a dry-run turn that counts as one AI message. */
  @Post("scenarios/run")
  @HttpCode(200)
  @Roles("owner", "admin")
  async run(@CurrentTenantDb() db: TenantDb, @Body() body: unknown): Promise<RunScenariosResponse> {
    const req = parseOrThrow(runScenariosRequestSchema, body ?? {});
    const rows = await db.run((tx) => {
      const q = tx.select().from(aiScenarios);
      return (req.scenarioIds ? q.where(inArray(aiScenarios.id, req.scenarioIds)) : q).orderBy(asc(aiScenarios.createdAt), asc(aiScenarios.id)).limit(MAX_SCENARIOS);
    });
    const results: ScenarioRunResult[] = [];
    let budgetStop = false;
    for (const s of rows) {
      const expectations = s.expectations as AiScenarioExpectation[];
      if (budgetStop) {
        // Stopped at the first budget refusal: the rest is reported, not run (nothing spent).
        results.push({ scenarioId: s.id, name: s.name, passed: false, checks: expectations.map((e) => ({ expectation: e, passed: false, detail: "no ejecutado" })), simulation: null, error: "not_run_budget_exceeded" });
        continue;
      }
      try {
        const simulation = await this.simulator.simulate(db, {
          messages: s.messages.map((text) => ({ author: "contact" as const, text })),
          ...(req.draftSystemPrompt !== undefined ? { draftSystemPrompt: req.draftSystemPrompt } : {}),
        });
        const checks = checkExpectations(simulation, expectations);
        results.push({ scenarioId: s.id, name: s.name, passed: checks.every((c) => c.passed), checks, simulation, error: null });
      } catch (err) {
        const error = failureOf(err);
        if (err instanceof AiBudgetExceededError) budgetStop = true;
        results.push({
          scenarioId: s.id,
          name: s.name,
          passed: false,
          checks: expectations.map((e) => ({ expectation: e, passed: false, detail: "no se pudo simular" })),
          simulation: null,
          error,
        });
      }
    }
    const passed = results.filter((r) => r.passed).length;
    return { results, passed, failed: results.length - passed };
  }
}
