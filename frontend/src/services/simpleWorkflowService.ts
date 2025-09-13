import { GoogleGenerativeAI } from '@google/generative-ai';
import type { WorkflowState, SimplePolicy, DemandResult, SimplePlan, PlanItem, HumanInput } from '../types/workflow';
import { parseCSV } from '../utils/csvParser';
import { loadCSVFile } from '../utils/fileLoader';

export class SimpleWorkflowService {
  private genAI: GoogleGenerativeAI | null = null;
  private model: any = null;
  private budgetData: any[] = [];
  private skuCostData: Record<string, { holdingCost: number; shortageCost: number }> = {};
  private warehouseConstraints: any[] = [];

  constructor() {
    let apiKey = '';
    if (typeof import.meta !== 'undefined' && import.meta.env) {
      apiKey = import.meta.env.VITE_GEMINI_API_KEY || '';
    }
    
    if (apiKey) {
      try {
        this.genAI = new GoogleGenerativeAI(apiKey);
        this.model = this.genAI.getGenerativeModel({ model: "gemini-2.5-pro" });
        console.log('✅ AI initialized successfully');
      } catch (error) {
        console.error('❌ AI initialization failed:', error);
        this.genAI = null;
        this.model = null;
      }
    } else {
      console.warn('⚠️ No API key found - using fallback mode only');
    }
    
    // Load budget and SKU cost data
    this.loadBudgetAndCostData();
  }

  private async loadBudgetAndCostData() {
    try {
      // Load budget data
      const budgetCsv = await loadCSVFile('/budget_df.csv');
      this.budgetData = this.parseBudgetCSV(budgetCsv);
      console.log('📊 Budget data loaded:', this.budgetData.length, 'records');
      
      // Load SKU cost data
      const skuCsv = await loadCSVFile('/SKU_Costs.csv');
      this.skuCostData = this.parseSKUCostCSV(skuCsv);
      console.log('💰 SKU cost data loaded:', Object.keys(this.skuCostData).length, 'products');
      
      // Load warehouse constraints
      const warehouseCsv = await loadCSVFile('/warehouse_constraints.csv');
      this.warehouseConstraints = this.parseWarehouseConstraintsCSV(warehouseCsv);
      console.log('🏭 Warehouse constraints loaded:', this.warehouseConstraints.length, 'records');
    } catch (error) {
      console.error('❌ Failed to load budget/cost data:', error);
    }
  }

  private async loadBusinessData() {
    try {
      const businessCsv = await loadCSVFile('/businesses.csv');
      const { parseBusinessesCSV } = await import('../utils/businessParser');
      return parseBusinessesCSV(businessCsv);
    } catch (error) {
      console.error('❌ Failed to load business data:', error);
      return [];
    }
  }

  private parseBudgetCSV(csvContent: string): any[] {
    const lines = csvContent.trim().split('\n');
    return lines.slice(1).map(line => {
      const [ds, budget] = line.split(',');
      return {
        date: ds,
        budget: parseFloat(budget) || 0
      };
    }).filter(row => row.date && !isNaN(row.budget));
  }

  private parseSKUCostCSV(csvContent: string): Record<string, { holdingCost: number; shortageCost: number }> {
    const lines = csvContent.trim().split('\n');
    const costData: Record<string, { holdingCost: number; shortageCost: number }> = {};
    
    lines.slice(1).forEach(line => {
      const [product, holdingCost, shortageCost] = line.split(',');
      if (product && !isNaN(parseFloat(holdingCost)) && !isNaN(parseFloat(shortageCost))) {
        costData[product] = {
          holdingCost: parseFloat(holdingCost),
          shortageCost: parseFloat(shortageCost)
        };
      }
    });
    
    return costData;
  }

  private parseWarehouseConstraintsCSV(csvContent: string): any[] {
    const lines = csvContent.trim().split('\n');
    return lines.slice(1).map(line => {
      const [ds, capacity, warehouse] = line.split(',');
      return {
        date: ds,
        capacity: parseFloat(capacity) || 0,
        warehouse: parseInt(warehouse) || 0
      };
    }).filter(row => row.date && !isNaN(row.capacity) && !isNaN(row.warehouse));
  }

  private getCurrentBudget(): number {
    if (this.budgetData.length === 0) return 10000; // Fallback
    const latestBudget = this.budgetData[this.budgetData.length - 1];
    return latestBudget.budget;
  }

  public getMaxBudget(): number {
    return this.getCurrentBudget();
  }

  private getBudgetContext(): string {
    if (this.budgetData.length === 0) return "No budget data available";
    
    const latest = this.budgetData[this.budgetData.length - 1];
    const average = this.budgetData.reduce((sum, item) => sum + item.budget, 0) / this.budgetData.length;
    const trend = this.budgetData.length > 1 ? 
      (latest.budget - this.budgetData[this.budgetData.length - 2].budget) : 0;
    
    return `Current budget: $${latest.budget.toFixed(0)}, Average: $${average.toFixed(0)}, Trend: ${trend > 0 ? '+' : ''}${trend.toFixed(0)}`;
  }

  private getCostContext(plan: SimplePlan): string {
    const costAnalysis = plan.items.map(item => {
      const skuCost = this.skuCostData[item.itemId];
      if (!skuCost) return `${item.itemName}: No cost data`;
      
      const holdingCost = item.quantity * skuCost.holdingCost;
      const shortageRisk = skuCost.shortageCost;
      const costRatio = skuCost.shortageCost / skuCost.holdingCost;
      
      return `${item.itemName}: Holding cost $${holdingCost.toFixed(0)}, Shortage risk $${shortageRisk}, Ratio ${costRatio.toFixed(1)}`;
    }).join('; ');
    
    return costAnalysis;
  }

  private getCurrentWarehouseCapacity(warehouseId: number): number {
    if (this.warehouseConstraints.length === 0) return 1000; // Fallback
    const latest = this.warehouseConstraints
      .filter(c => c.warehouse === warehouseId)
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0];
    return latest ? latest.capacity : 1000;
  }

  private calculateNewsvendorQuantity(demand: number, confidenceLow: number, confidenceHigh: number, holdingCost: number, shortageCost: number): number {
    // Create normal distribution from confidence intervals
    const mean = demand;
    const stdDev = (confidenceHigh - confidenceLow) / (2 * 1.96); // 95% CI approximation
    
    // Newsvendor parameters
    const p = shortageCost + 10; // Purchasing price
    const c = holdingCost; // Holding cost
    const s = 0; // Salvage value (assumed 0)
    
    // Critical ratio
    const criticalRatio = (p - c) / (p - s);
    
    // Calculate optimal quantity using normal distribution
    // For normal distribution: Q* = μ + σ * Φ^(-1)(criticalRatio)
    const zScore = this.inverseNormalCDF(criticalRatio);
    const optimalQuantity = mean + stdDev * zScore;
    
    // Round up to next integer
    return Math.ceil(Math.max(0, optimalQuantity));
  }

  private inverseNormalCDF(p: number): number {
    // Simplified approximation of inverse normal CDF
    // Using Box-Muller transformation approximation
    if (p <= 0 || p >= 1) {
      return p <= 0 ? -Infinity : Infinity;
    }
    
    // Approximation for 0 < p < 1
    const a0 = -3.969683028665376e+01;
    const a1 = 2.209460984245205e+02;
    const a2 = -2.759285104469687e+02;
    const a3 = 1.383577518672690e+02;
    const a4 = -3.066479806614201e+01;
    const a5 = 2.506628277459239e+00;
    
    const b1 = -5.447609879822406e+01;
    const b2 = 1.615858368580409e+02;
    const b3 = -1.556989798598866e+02;
    const b4 = 6.680131188771972e+01;
    const b5 = -1.328068155288572e+01;
    
    const c0 = -7.784894002430293e-03;
    const c1 = -3.223964580411365e-01;
    const c2 = -2.400758277161838e+00;
    const c3 = -2.549732539343734e+00;
    const c4 = 4.374664141464968e+00;
    const c5 = 2.938163982698783e+00;
    
    const d1 = 7.784695709041462e-03;
    const d2 = 3.224671290700398e-01;
    const d3 = 2.445134137142996e+00;
    const d4 = 3.754408661907416e+00;
    
    const split1 = 0.425;
    const split2 = 5.0;
    const const1 = 0.180625;
    const const2 = 1.6;
    
    let r: number, val: number;
    
    if (p < split1) {
      r = const1 - p * p;
      val = p * (((((a5 * r + a4) * r + a3) * r + a2) * r + a1) * r + a0) / (((((b5 * r + b4) * r + b3) * r + b2) * r + b1) * r + 1);
    } else if (p < split2) {
      r = p - 0.5;
      const r2 = r * r;
      val = (((((a5 * r2 + a4) * r2 + a3) * r2 + a2) * r2 + a1) * r2 + a0) * r / (((((b5 * r2 + b4) * r2 + b3) * r2 + b2) * r2 + b1) * r2 + 1);
    } else {
      r = Math.sqrt(-Math.log(1 - p));
      if (r <= 5.0) {
        r = r - const2;
        val = (((((c5 * r + c4) * r + c3) * r + c2) * r + c1) * r + c0) / ((((d4 * r + d3) * r + d2) * r + d1) * r + 1);
      } else {
        r = r - 2.0;
        val = (((((c5 * r + c4) * r + c3) * r + c2) * r + c1) * r + c0) / ((((d4 * r + d3) * r + d2) * r + d1) * r + 1);
      }
    }
    
    return val;
  }

  private checkHumanInputRequired(plan: SimplePlan): boolean {
    // Check if any individual item has holding cost > shortage cost
    console.log('🔍 Checking human input requirement for plan items:', plan.items.length);
    
    return plan.items.some(item => {
      const productId = item.itemId.split('/').pop() || item.itemId;
      const skuCost = this.skuCostData[productId];
      
      console.log(`📊 Item: ${item.itemName} (${item.itemId})`);
      console.log(`   Product ID: ${productId}`);
      console.log(`   Quantity: ${item.quantity}`);
      console.log(`   SKU Cost found: ${!!skuCost}`);
      
      if (!skuCost) {
        console.log(`   ❌ No SKU cost data for product ${productId}`);
        return false;
      }
      
      const totalHoldingCost = item.quantity * skuCost.holdingCost;
      const totalShortageCost = item.quantity * skuCost.shortageCost;
      
      console.log(`   Holding Cost: ${skuCost.holdingCost} × ${item.quantity} = ${totalHoldingCost}`);
      console.log(`   Shortage Cost: ${skuCost.shortageCost} × ${item.quantity} = ${totalShortageCost}`);
      console.log(`   Human input required: ${totalHoldingCost > totalShortageCost}`);
      
      return totalHoldingCost > totalShortageCost;
    });
  }

  /**
   * Run complete minimalist workflow with real-time updates
   */
  async runWorkflow(itemIds: string[], policy: SimplePolicy, onUpdate?: (state: WorkflowState) => void): Promise<WorkflowState> {
    console.log('🚀 Starting minimalist workflow...');
    console.log('📦 Item IDs received:', itemIds);
    
    const state: WorkflowState = {
      status: 'running',
      demandResults: [],
      purchasePlan: null,
      messages: [],
      agentChat: [],
      awaitingHumanInput: false,
      showResults: false
    };

    const updateState = () => {
      if (onUpdate) onUpdate({ ...state });
    };

    try {
      // Step 0: Start agent conversation
      await this.startAgentConversation(state, policy);
      updateState();

      // Step 1: Demand Agent - Analyze forecasts and confidence scores
      console.log('📊 Step 1: Demand Analysis');
      const csvData = await loadCSVFile('/scored_df.csv');
      const allPredictions = parseCSV(csvData);
      console.log('📊 Total predictions loaded:', allPredictions.length);
      console.log('🔍 Looking for item IDs:', itemIds);
      
      // Group by item_id and get only the newest record for each item
      const groupedPredictions = allPredictions.reduce((acc, item) => {
        if (!acc[item.item_id]) {
          acc[item.item_id] = [];
        }
        acc[item.item_id].push(item);
        return acc;
      }, {} as Record<string, any[]>);
      
      // Get only the newest record for each item (for AI analysis)
      const newestPredictions = Object.values(groupedPredictions).map(itemGroup => {
        const sortedItems = itemGroup.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
        return sortedItems[0]; // Only the newest record
      }).filter(p => itemIds.includes(p.item_id));
      
      console.log('✅ Newest predictions for analysis:', newestPredictions.length);

      state.demandResults = await this.analyzeDemandRefined(newestPredictions, policy, state, updateState, allPredictions);

      // Step 2: Purchasing Agent - Newsvendor policy for inventory
      console.log('🛒 Step 2: Purchasing Analysis (Newsvendor Policy)');
      state.purchasePlan = await this.generatePurchasePlanRefined(state.demandResults, policy, state, updateState);

      // Step 3: Risk Agent - Apply warehouse capacity constraints
      console.log('⚠️ Step 3: Risk Analysis (Warehouse Constraints)');
      state.purchasePlan = await this.applyWarehouseConstraints(state.purchasePlan, state, updateState);

      // Step 4: Check if human input is required
      const humanInputRequired = this.checkHumanInputRequired(state.purchasePlan);
      console.log('🤔 Human input required:', humanInputRequired);

      if (humanInputRequired) {
        // Step 5: Wait for human input
        state.status = 'waiting_for_input';
        state.awaitingHumanInput = true;
        state.showResults = false;
        updateState();
        console.log('⏸️ Waiting for human input due to holding cost > shortage cost...');
      } else {
        // Step 5: Final consensus without human input
        await this.finalAgentConsensusRefined(state, updateState);
        state.showResults = true;
        state.status = 'complete';
        console.log('✅ Final workflow complete without human input!');
      }
      
      return state;

    } catch (error) {
      console.error('❌ Workflow failed:', error);
      state.messages.push(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      state.status = 'complete';
      updateState();
      return state;
    }
  }


  private calculateConfidence(pred: any): number {
    // Use the actual confidence score from the CSV if available
    if (pred.confidence_score !== undefined) {
      return Math.max(0.1, Math.min(0.95, pred.confidence_score));
    }
    
    // Fallback to calculated confidence based on range
    const range = pred.hi - pred.lo;
    const forecast = pred.yhat;
    return Math.max(0.1, Math.min(0.95, 1 - (range / Math.max(forecast, 1))));
  }

  private calculateTarget(pred: any, confidence: number, policy: SimplePolicy): number {
    let multiplier = 1.0;
    
    // Adjust based on policy
    if (policy.conservatismLevel === 'high') multiplier = 1.3;
    else if (policy.conservatismLevel === 'medium') multiplier = 1.15;
    else multiplier = 1.0;

    // Adjust based on confidence
    if (confidence < 0.5) multiplier *= 1.2;
    else if (confidence > 0.8) multiplier *= 0.9;

    return Math.ceil(pred.yhat * multiplier);
  }

  private async getAIReasoning(pred: any, confidence: number, target: number, historicalData?: any[]): Promise<string> {
    console.log('🤖 Getting AI reasoning for:', pred.name);
    
    // Build historical context if available
    let historicalContext = '';
    if (historicalData && historicalData.length > 0) {
      historicalContext = `\nHistorical Data (for context):\n${historicalData.map((hist: any) => 
        `- ${hist.date}: ${hist.yhat.toFixed(2)} (confidence: ${(hist.confidence_score * 100).toFixed(0)}%)`
      ).join('\n')}`;
    }
    
    const prompt = `Item: ${pred.name}
Current Forecast: ${pred.yhat}
Confidence: ${(confidence * 100).toFixed(0)}%
Target Quantity: ${target}
Current Date: ${pred.date}${historicalContext}

Provide a 1-sentence explanation for this demand target, considering historical trends if available.`;

    console.log('📝 Sending prompt to AI...');
    
    // Add timeout to prevent stalling
    const timeoutPromise = new Promise<string>((_, reject) => {
      setTimeout(() => reject(new Error('AI call timeout after 30 seconds')), 30000);
    });
    
    const aiPromise = this.model!.generateContent(prompt).then(async (result: any) => {
      const response = await result.response;
      return response.text().trim();
    });
    
    try {
      const reasoning = await Promise.race([aiPromise, timeoutPromise]);
      console.log('✅ AI reasoning received:', reasoning);
      return reasoning;
    } catch (error) {
      console.log('❌ AI call failed or timed out:', error);
      throw error;
    }
  }

  private getFallbackReasoning(pred: any, confidence: number, target: number): string {
    const confLevel = confidence > 0.7 ? 'high' : confidence > 0.4 ? 'medium' : 'low';
    const adjustment = target > pred.yhat ? 'increased' : target < pred.yhat ? 'decreased' : 'maintained';
    return `Target ${adjustment} to ${target} units based on ${confLevel} confidence forecast of ${pred.yhat}.`;
  }

  private async getPlanReasoning(items: PlanItem[], totalCost: number, policy: SimplePolicy): Promise<string> {
    const prompt = `Purchase plan summary:
Items: ${items.length}
Total cost: $${totalCost.toLocaleString()}
Policy: ${policy.conservatismLevel} conservatism, max $${policy.maxCost.toLocaleString()}

Provide a 1-sentence strategic assessment.`;

    const result = await this.model!.generateContent(prompt);
    const response = await result.response;
    return response.text().trim();
  }

  private getFallbackPlanReasoning(items: PlanItem[], totalCost: number, policy: SimplePolicy): string {
    const withinBudget = totalCost <= policy.maxCost;
    const budgetStatus = withinBudget ? 'within budget' : `exceeds budget by $${(totalCost - policy.maxCost).toLocaleString()}`;
    return `Plan for ${items.length} items totaling $${totalCost.toLocaleString()} is ${budgetStatus} with ${policy.conservatismLevel} risk approach.`;
  }

  /**
   * Multi-agent conversation methods
   */
  private addChatMessage(state: WorkflowState, agent: 'demand' | 'purchasing' | 'risk' | 'human', message: string, isThinking: boolean = false) {
    state.agentChat.push({
      id: `${agent}_${Date.now()}_${Math.random()}`,
      timestamp: new Date().toISOString(),
      agent,
      message,
      isThinking
    });
  }

  private async startAgentConversation(state: WorkflowState, policy: SimplePolicy) {
    console.log('💬 Starting agent conversation...');
    this.addChatMessage(state, 'demand', `Working with ${policy.conservatismLevel} risk level and $${policy.maxCost.toLocaleString()} budget. Starting analysis...`);
    console.log('✅ Agent conversation started');
  }

  private async discussDemandResults(state: WorkflowState, results: DemandResult[], updateState?: () => void) {
    console.log('💬 Starting demand results discussion...');
    
    if (!this.model) {
      console.log('🔄 FALLBACK: Skipping agent discussion - no AI available');
      this.addChatMessage(state, 'demand', 'Analysis complete. Calculated targets for all items based on forecast confidence.');
      return;
    }

    try {
      // Demand agent shares findings
      const highConfidenceItems = results.filter(r => r.confidence > 0.7).length;
      const totalTarget = results.reduce((sum, r) => sum + r.targetQuantity, 0);
      
      console.log(`📊 Demand analysis: ${results.length} items, ${highConfidenceItems} high confidence, ${totalTarget} total units`);
      this.addChatMessage(state, 'demand', `Analyzed ${results.length} items. ${highConfidenceItems} have high confidence (>70%). Total target: ${totalTarget} units.`);
      if (updateState) updateState();
      
      console.log('⏳ Waiting 1 second before risk agent response...');
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Risk agent responds with AI
      console.log('🤖 Calling AI for risk agent response...');
      const riskPrompt = `As a Risk Agent, respond in 1-2 sentences about demand analysis showing ${highConfidenceItems}/${results.length} high confidence items with ${totalTarget} total units. Consider market risks.`;
      
      // Add timeout to prevent stalling
      const timeoutPromise = new Promise<string>((_, reject) => {
        setTimeout(() => reject(new Error('Risk agent AI call timeout after 30 seconds')), 30000);
      });
      
      const aiPromise = this.model.generateContent(riskPrompt).then(async (result: any) => {
        const response = await result.response;
        return response.text().trim();
      });
      
      const riskText = await Promise.race([aiPromise, timeoutPromise]);
      console.log('✅ Risk agent response received');
      this.addChatMessage(state, 'risk', riskText);
      if (updateState) updateState();
      
      console.log('⏳ Waiting 800ms before purchasing agent response...');
      await new Promise(resolve => setTimeout(resolve, 800));
      
      // Purchasing agent responds with analysis
      console.log('💬 Adding purchasing agent message...');
      this.addChatMessage(state, 'purchasing', 'Excellent demand analysis. I\'ll now evaluate procurement strategies, supplier options, and cost optimization opportunities to maximize revenue potential.');
      if (updateState) updateState();
      console.log('✅ Demand results discussion completed');
      
    } catch (error) {
      console.log('🔄 FALLBACK: Agent discussion failed, using simple messages', error);
      this.addChatMessage(state, 'demand', 'Analysis complete. Moving to procurement planning.');
      this.addChatMessage(state, 'risk', 'Demand targets look reasonable given current market conditions.');
      this.addChatMessage(state, 'purchasing', 'Ready to optimize procurement based on these targets.');
    }
  }

  private async discussPurchasePlan(state: WorkflowState, plan: SimplePlan, policy: SimplePolicy, updateState?: () => void) {
    if (!this.model) {
      console.log('🔄 FALLBACK: Skipping plan discussion - no AI available');
      this.addChatMessage(state, 'purchasing', `Plan ready. Total cost: $${plan.totalCost.toLocaleString()} for ${plan.totalUnits} units.`);
      return;
    }

    try {
      // Purchasing agent does detailed analysis first
      const withinBudget = plan.totalCost <= policy.maxCost;
      const budgetContext = this.getBudgetContext();
      const costContext = this.getCostContext(plan);
      
      // Purchasing agent provides detailed analysis
      const purchasingPrompt = `As a Purchasing Agent, analyze this procurement plan: $${plan.totalCost.toLocaleString()} cost, ${plan.totalUnits} units, ${withinBudget ? 'within' : 'exceeds'} budget of $${policy.maxCost.toLocaleString()}.

Budget Context: ${budgetContext}
Cost Analysis: ${costContext}

Provide a 2-3 sentence analysis focusing on:
1. Cost optimization opportunities
2. Supplier selection strategy
3. Revenue maximization potential
4. Any procurement risks or concerns`;

      console.log('🤖 Calling AI for purchasing agent analysis...');
      const purchasingResponse = await this.model.generateContent(purchasingPrompt);
      const purchasingText = await purchasingResponse.response.text();
      this.addChatMessage(state, 'purchasing', purchasingText.trim());
      if (updateState) updateState();
      
      await new Promise(resolve => setTimeout(resolve, 1200));
      
      // Risk agent evaluates with budget and cost data
      const riskPrompt = `As a Risk Agent, evaluate this purchase plan: $${plan.totalCost.toLocaleString()} cost, ${plan.totalUnits} units, ${withinBudget ? 'within' : 'exceeds'} budget of $${policy.maxCost.toLocaleString()}. 
      
Budget Context: ${budgetContext}
Cost Analysis: ${costContext}

Respond in 1-2 sentences about financial risk and revenue optimization opportunities.`;
      
      const riskResponse = await this.model.generateContent(riskPrompt);
      const riskText = await riskResponse.response.text();
      this.addChatMessage(state, 'risk', riskText.trim());
      if (updateState) updateState();
      
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Demand agent responds with cost considerations
      const demandPrompt = `As a Demand Agent, comment on this purchase plan with ${plan.totalUnits} units total. Consider holding costs vs shortage costs for revenue maximization. Does this align with demand forecasts? Respond in 1 sentence.`;
      
      const demandResponse = await this.model.generateContent(demandPrompt);
      const demandText = await demandResponse.response.text();
      this.addChatMessage(state, 'demand', demandText.trim());
      if (updateState) updateState();
      
    } catch (error) {
      console.log('🔄 FALLBACK: Plan discussion failed, using simple messages');
      this.addChatMessage(state, 'purchasing', `Plan ready: $${plan.totalCost.toLocaleString()} total cost.`);
      this.addChatMessage(state, 'risk', 'Plan appears financially sound given current constraints.');
      this.addChatMessage(state, 'demand', 'Quantities align well with our demand forecasts.');
    }
  }

  /**
   * Process human input and create final consensus
   */
  async processHumanInput(state: WorkflowState, humanInput: HumanInput, onUpdate?: (state: WorkflowState) => void): Promise<WorkflowState> {
    console.log('👤 Processing human input...');
    
    state.humanInput = humanInput;
    state.awaitingHumanInput = false;
    state.status = 'running';
    // Don't show results yet - wait until after plan modification
    
    const updateState = () => {
      if (onUpdate) onUpdate({ ...state });
    };
    
    // Add human input as a chat message
    this.addChatMessage(state, 'human', humanInput.feedback);
    updateState();
    
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Agents discuss the human input
    await this.discussHumanInput(state, humanInput, updateState);
    updateState();
    
    // Modify the plan based on human input
    await this.modifyPlanBasedOnHumanInput(state, humanInput, updateState);
    
    // Create final consensus incorporating human input
    await this.finalAgentConsensusWithHumanInput(state, updateState);
    updateState();
    
    // Show results after human input is processed
    state.showResults = true;
    state.status = 'complete';
    console.log('✅ Final workflow complete!');
    console.log('🔓 showResults set to true - plan should now be visible');
    
    return state;
  }

  private async modifyPlanBasedOnHumanInput(state: WorkflowState, humanInput: HumanInput, updateState?: () => void) {
    console.log('🔧 Modifying plan based on human input...');
    console.log('📝 Human feedback:', humanInput.feedback);
    
    if (!state.purchasePlan) {
      console.log('⚠️ No purchase plan to modify');
      return;
    }

    console.log('📊 Original plan:', {
      totalCost: state.purchasePlan.totalCost,
      totalUnits: state.purchasePlan.totalUnits,
      items: state.purchasePlan.items.map(item => ({
        name: item.itemName,
        quantity: item.quantity,
        cost: item.totalCost
      }))
    });

    // Parse human feedback for specific adjustments
    const feedback = humanInput.feedback.toLowerCase();
    let modified = false;
    const originalPlan = { ...state.purchasePlan };
    
    // Check for budget concerns
    if (feedback.includes('budget') || feedback.includes('cost') || feedback.includes('expensive')) {
      console.log('💰 Budget concern detected');
      // Reduce quantities by 10-20% to lower costs
      const reductionFactor = feedback.includes('very') ? 0.7 : 0.85;
      console.log('📉 Reduction factor:', reductionFactor);
      
      state.purchasePlan.items.forEach(item => {
        const newQuantity = Math.max(1, Math.floor(item.quantity * reductionFactor));
        console.log(`📦 ${item.itemName}: ${item.quantity} → ${newQuantity}`);
        if (newQuantity !== item.quantity) {
          item.quantity = newQuantity;
          item.totalCost = item.quantity * item.unitCost;
          modified = true;
        }
      });
      
      if (modified) {
        // Recalculate totals
        state.purchasePlan.totalUnits = state.purchasePlan.items.reduce((sum, item) => sum + item.quantity, 0);
        state.purchasePlan.totalCost = state.purchasePlan.items.reduce((sum, item) => sum + item.totalCost, 0);
        
        console.log('✅ Plan modified - New totals:', {
          totalCost: state.purchasePlan.totalCost,
          totalUnits: state.purchasePlan.totalUnits
        });
        
        this.addChatMessage(state, 'purchasing', `Reduced quantities by ${Math.round((1 - reductionFactor) * 100)}% to address budget concerns. New total: $${state.purchasePlan.totalCost.toLocaleString()}`);
      } else {
        console.log('⚠️ No quantities were modified');
      }
    }
    
    // Check for risk concerns
    if (feedback.includes('risk') || feedback.includes('conservative') || feedback.includes('safe')) {
      console.log('⚠️ Risk concern detected');
      // Reduce quantities by 15-25% for more conservative approach
      const reductionFactor = feedback.includes('very') ? 0.75 : 0.9;
      console.log('📉 Risk reduction factor:', reductionFactor);
      
      state.purchasePlan.items.forEach(item => {
        const newQuantity = Math.max(1, Math.floor(item.quantity * reductionFactor));
        console.log(`📦 ${item.itemName}: ${item.quantity} → ${newQuantity}`);
        if (newQuantity !== item.quantity) {
          item.quantity = newQuantity;
          item.totalCost = item.quantity * item.unitCost;
          modified = true;
        }
      });
      
      if (modified) {
        // Recalculate totals
        state.purchasePlan.totalUnits = state.purchasePlan.items.reduce((sum, item) => sum + item.quantity, 0);
        state.purchasePlan.totalCost = state.purchasePlan.items.reduce((sum, item) => sum + item.totalCost, 0);
        
        console.log('✅ Plan modified for risk - New totals:', {
          totalCost: state.purchasePlan.totalCost,
          totalUnits: state.purchasePlan.totalUnits
        });
        
        this.addChatMessage(state, 'risk', `Adopted more conservative approach, reducing quantities by ${Math.round((1 - reductionFactor) * 100)}%. New total: $${state.purchasePlan.totalCost.toLocaleString()}`);
      } else {
        console.log('⚠️ No quantities were modified for risk');
      }
    }
    
    // Check for specific item mentions
    const itemMentions = state.purchasePlan.items.filter(item => 
      feedback.includes(item.itemName.toLowerCase()) || 
      feedback.includes(item.itemId.toLowerCase())
    );
    
    console.log('🔍 Item mentions found:', itemMentions.map(item => item.itemName));
    
    if (itemMentions.length > 0) {
      console.log('📦 Adjusting specific items');
      // Reduce specific mentioned items by 30%
      itemMentions.forEach(item => {
        const newQuantity = Math.max(1, Math.floor(item.quantity * 0.7));
        console.log(`📦 ${item.itemName}: ${item.quantity} → ${newQuantity}`);
        if (newQuantity !== item.quantity) {
          item.quantity = newQuantity;
          item.totalCost = item.quantity * item.unitCost;
          modified = true;
        }
      });
      
      if (modified) {
        // Recalculate totals
        state.purchasePlan.totalUnits = state.purchasePlan.items.reduce((sum, item) => sum + item.quantity, 0);
        state.purchasePlan.totalCost = state.purchasePlan.items.reduce((sum, item) => sum + item.totalCost, 0);
        
        console.log('✅ Plan modified for specific items - New totals:', {
          totalCost: state.purchasePlan.totalCost,
          totalUnits: state.purchasePlan.totalUnits
        });
        
        this.addChatMessage(state, 'demand', `Adjusted quantities for mentioned items based on your feedback. New total: $${state.purchasePlan.totalCost.toLocaleString()}`);
      } else {
        console.log('⚠️ No quantities were modified for specific items');
      }
    }
    
    // Final summary
    console.log('📊 Final modification result:', {
      modified,
      originalCost: originalPlan.totalCost,
      newCost: state.purchasePlan.totalCost,
      originalUnits: originalPlan.totalUnits,
      newUnits: state.purchasePlan.totalUnits
    });
    
    // If no specific changes were made, make a small adjustment to test the system
    if (!modified) {
      console.log('💬 No keyword matches, making small test adjustment');
      // Make a small 5% reduction to test the modification system
      state.purchasePlan.items.forEach(item => {
        const newQuantity = Math.max(1, Math.floor(item.quantity * 0.95));
        if (newQuantity !== item.quantity) {
          item.quantity = newQuantity;
          item.totalCost = item.quantity * item.unitCost;
          modified = true;
        }
      });
      
      if (modified) {
        // Recalculate totals
        state.purchasePlan.totalUnits = state.purchasePlan.items.reduce((sum, item) => sum + item.quantity, 0);
        state.purchasePlan.totalCost = state.purchasePlan.items.reduce((sum, item) => sum + item.totalCost, 0);
        
        this.addChatMessage(state, 'purchasing', `Made small adjustments based on your feedback. New total: $${state.purchasePlan.totalCost.toLocaleString()}`);
        console.log('✅ Test modification applied');
      }
    }
    
    if (modified) {
      // Update the reasoning to reflect the changes
      state.purchasePlan.reasoning = `Plan modified based on human feedback. Original: $${originalPlan.totalCost.toLocaleString()}, ${originalPlan.totalUnits} units. Modified: $${state.purchasePlan.totalCost.toLocaleString()}, ${state.purchasePlan.totalUnits} units.`;
      console.log('📝 Updated plan reasoning');
    } else {
      console.log('⚠️ No modifications could be applied');
      this.addChatMessage(state, 'purchasing', 'Thank you for the feedback. We\'ll keep the current plan but will monitor these concerns closely.');
    }
    
    if (updateState) updateState();
  }

  private async discussHumanInput(state: WorkflowState, humanInput: HumanInput, updateState?: () => void) {
    if (!this.model) {
      console.log('🔄 FALLBACK: Skipping human input discussion - no AI available');
      this.addChatMessage(state, 'risk', 'Thank you for the feedback. We will incorporate your suggestions.');
      this.addChatMessage(state, 'purchasing', 'Adjusting plan based on human input.');
      this.addChatMessage(state, 'demand', 'Updated targets considering your feedback.');
      return;
    }

    try {
      // Risk agent responds to human input
      const riskPrompt = `As a Risk Agent, respond to this human feedback: "${humanInput.feedback}". Consider how this affects our risk assessment and what adjustments might be needed. Respond in 1-2 sentences.`;
      
      const riskResponse = await this.model.generateContent(riskPrompt);
      const riskText = await riskResponse.response.text();
      this.addChatMessage(state, 'risk', riskText.trim());
      if (updateState) updateState();
      
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Purchasing agent responds
      const purchasingPrompt = `As a Purchasing Agent, respond to this human feedback: "${humanInput.feedback}". Consider how this affects our procurement strategy and cost optimization. Respond in 1-2 sentences.`;
      
      const purchasingResponse = await this.model.generateContent(purchasingPrompt);
      const purchasingText = await purchasingResponse.response.text();
      this.addChatMessage(state, 'purchasing', purchasingText.trim());
      if (updateState) updateState();
      
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Demand agent responds
      const demandPrompt = `As a Demand Agent, respond to this human feedback: "${humanInput.feedback}". Consider how this affects our demand forecasts and target quantities. Respond in 1-2 sentences.`;
      
      const demandResponse = await this.model.generateContent(demandPrompt);
      const demandText = await demandResponse.response.text();
      this.addChatMessage(state, 'demand', demandText.trim());
      if (updateState) updateState();
      
    } catch (error) {
      console.log('🔄 FALLBACK: Human input discussion failed, using simple messages');
      this.addChatMessage(state, 'risk', 'Thank you for the feedback. We will incorporate your suggestions.');
      this.addChatMessage(state, 'purchasing', 'Adjusting plan based on human input.');
      this.addChatMessage(state, 'demand', 'Updated targets considering your feedback.');
    }
  }

  private async initialAgentConsensus(state: WorkflowState, updateState?: () => void) {
    await new Promise(resolve => setTimeout(resolve, 800));
    
    if (!this.model) {
      console.log('🔄 FALLBACK: Skipping consensus discussion - no AI available');
      this.addChatMessage(state, 'risk', 'Team consensus: Plan approved for execution.');
      return;
    }

    try {
      // Final consensus discussion
      const plan = state.purchasePlan!;
      const consensusPrompt = `As agents reaching consensus on a supply chain plan ($${plan.totalCost.toLocaleString()}, ${plan.totalUnits} units), provide a final 1-sentence team agreement.`;
      
      this.addChatMessage(state, 'demand', 'Team, are we all aligned on this plan?', true);
      if (updateState) updateState();
      await new Promise(resolve => setTimeout(resolve, 600));
      
      this.addChatMessage(state, 'purchasing', 'Costs are optimized given our constraints.', true);
      if (updateState) updateState();
      await new Promise(resolve => setTimeout(resolve, 600));
      
      const consensusResponse = await this.model.generateContent(consensusPrompt);
      const consensusText = await consensusResponse.response.text();
      this.addChatMessage(state, 'risk', consensusText.trim());
      if (updateState) updateState();
      
      await new Promise(resolve => setTimeout(resolve, 500));
      this.addChatMessage(state, 'demand', 'We have reached initial consensus. Awaiting human review and input.');
      if (updateState) updateState();
      
    } catch (error) {
      console.log('🔄 FALLBACK: Consensus discussion failed, using simple message');
      this.addChatMessage(state, 'risk', 'All agents in agreement - plan approved for execution.');
    }
  }

  private async finalAgentConsensusWithHumanInput(state: WorkflowState, updateState?: () => void) {
    await new Promise(resolve => setTimeout(resolve, 800));
    
    if (!this.model) {
      console.log('🔄 FALLBACK: Skipping final consensus - no AI available');
      this.addChatMessage(state, 'risk', 'Final consensus: Plan approved incorporating human feedback.');
      return;
    }

    try {
      // Final consensus incorporating human input
      const plan = state.purchasePlan!;
      const humanInput = state.humanInput!;
      const finalConsensusPrompt = `As agents reaching final consensus on a supply chain plan ($${plan.totalCost.toLocaleString()}, ${plan.totalUnits} units) after incorporating human feedback: "${humanInput.feedback}". Provide a final 1-sentence team agreement that acknowledges the human input.`;
      
      this.addChatMessage(state, 'demand', 'Incorporating human feedback into final decision...', true);
      if (updateState) updateState();
      await new Promise(resolve => setTimeout(resolve, 600));
      
      // Purchasing agent provides final analysis
      const purchasingFinalPrompt = `As a Purchasing Agent, provide final analysis of the modified plan ($${plan.totalCost.toLocaleString()}, ${plan.totalUnits} units) after incorporating human feedback: "${humanInput.feedback}". Focus on procurement efficiency and revenue optimization. Respond in 1-2 sentences.`;
      
      const purchasingFinalResponse = await this.model.generateContent(purchasingFinalPrompt);
      const purchasingFinalText = await purchasingFinalResponse.response.text();
      this.addChatMessage(state, 'purchasing', purchasingFinalText.trim(), true);
      if (updateState) updateState();
      await new Promise(resolve => setTimeout(resolve, 600));
      
      const consensusResponse = await this.model.generateContent(finalConsensusPrompt);
      const consensusText = await consensusResponse.response.text();
      this.addChatMessage(state, 'risk', consensusText.trim());
      if (updateState) updateState();
      
      await new Promise(resolve => setTimeout(resolve, 500));
      this.addChatMessage(state, 'demand', 'Final plan approved with human input incorporated.');
      if (updateState) updateState();
      
    } catch (error) {
      console.log('🔄 FALLBACK: Final consensus discussion failed, using simple message');
      this.addChatMessage(state, 'risk', 'Final consensus: Plan approved incorporating human feedback.');
    }
  }

  /**
   * Refined agentic workflow methods
   */
  private async analyzeDemandRefined(predictions: any[], policy: SimplePolicy, state: WorkflowState, updateState?: () => void, allPredictions?: any[]): Promise<DemandResult[]> {
    console.log('🔍 Demand Agent: Analyzing forecasts and confidence scores...');
    
    // Load business data to get actual product names
    const businessData = await this.loadBusinessData();
    const itemIdToProductName = new Map<string, string>();
    
    // Create mapping from item_id to product_name
    businessData.forEach(business => {
      business.item_ids.forEach((itemId, index) => {
        const productName = business.product_names[index] || `Product ${itemId}`;
        itemIdToProductName.set(itemId, productName);
      });
    });
    
    const results: DemandResult[] = [];
    
    for (const pred of predictions) {
      const confidence = this.calculateConfidence(pred);
      
      // Get the actual product name
      const actualProductName = itemIdToProductName.get(pred.item_id) || pred.name;
      
      // Demand agent analyzes forecast and confidence
      let reasoning = '';
      if (this.model) {
        try {
          const demandPrompt = `As a Demand Agent, analyze this forecast: Item ${actualProductName}, Forecast: ${pred.yhat}, Confidence: ${(confidence * 100).toFixed(1)}%, Confidence Interval: [${pred.lo.toFixed(2)}, ${pred.hi.toFixed(2)}]. Provide 1-2 sentences about demand patterns and confidence assessment.`;
          
          const demandResponse = await this.model.generateContent(demandPrompt);
          const demandText = await demandResponse.response.text();
          reasoning = demandText.trim();
        } catch (error) {
          console.log('🔄 FALLBACK: Using local reasoning for demand analysis');
          reasoning = `Forecast of ${pred.yhat} with ${(confidence * 100).toFixed(1)}% confidence. Interval: [${pred.lo.toFixed(2)}, ${pred.hi.toFixed(2)}].`;
        }
      } else {
        reasoning = `Forecast of ${pred.yhat} with ${(confidence * 100).toFixed(1)}% confidence. Interval: [${pred.lo.toFixed(2)}, ${pred.hi.toFixed(2)}].`;
      }
      
      results.push({
        itemId: pred.item_id,
        itemName: actualProductName,
        targetQuantity: pred.yhat, // Will be recalculated by purchasing agent
        confidence,
        reasoning
      });
    }
    
    // Add demand agent message
    this.addChatMessage(state, 'demand', `Analyzed ${results.length} items with forecast data and confidence intervals. Ready for purchasing optimization.`);
    if (updateState) updateState();
    
    return results;
  }

  private async generatePurchasePlanRefined(demandResults: DemandResult[], policy: SimplePolicy, state: WorkflowState, updateState?: () => void): Promise<SimplePlan> {
    console.log('🛒 Purchasing Agent: Applying newsvendor policy...');
    
    const items: PlanItem[] = [];
    let totalCost = 0;
    let totalUnits = 0;
    const weeklyBudget = this.getCurrentBudget();

    for (const demand of demandResults) {
      const productId = demand.itemId.split('/').pop() || demand.itemId;
      const skuCost = this.skuCostData[productId];
      
      if (!skuCost) {
        console.log(`⚠️ No cost data for product ${productId}, skipping`);
        continue;
      }
      
      // Find the original prediction data for confidence intervals
      const originalPred = demandResults.find(d => d.itemId === demand.itemId);
      if (!originalPred) continue;
      
      // Calculate newsvendor quantity
      const newsvendorQuantity = this.calculateNewsvendorQuantity(
        demand.targetQuantity,
        originalPred.targetQuantity * 0.8, // Approximate confidence low
        originalPred.targetQuantity * 1.2, // Approximate confidence high
        skuCost.holdingCost,
        skuCost.shortageCost
      );
      
      // Apply weekly budget constraint
      const purchasingPrice = skuCost.shortageCost + 10;
      const itemCost = newsvendorQuantity * purchasingPrice;
      
      if (totalCost + itemCost <= weeklyBudget) {
        items.push({
          itemId: demand.itemId,
          itemName: demand.itemName,
          quantity: newsvendorQuantity,
          unitCost: purchasingPrice,
          totalCost: itemCost
        });
        
        totalCost += itemCost;
        totalUnits += newsvendorQuantity;
      } else {
        console.log(`⚠️ Item ${demand.itemName} exceeds remaining budget, skipping`);
      }
    }
    
    // Add purchasing agent message
    this.addChatMessage(state, 'purchasing', `Applied newsvendor policy. Generated plan: $${totalCost.toLocaleString()} for ${totalUnits} units within $${weeklyBudget.toLocaleString()} weekly budget.`);
    if (updateState) updateState();
    
    return {
      items,
      totalCost,
      totalUnits,
      reasoning: `Newsvendor policy applied with weekly budget constraint of $${weeklyBudget.toLocaleString()}`
    };
  }

  private async applyWarehouseConstraints(plan: SimplePlan, state: WorkflowState, updateState?: () => void): Promise<SimplePlan> {
    console.log('⚠️ Risk Agent: Applying warehouse capacity constraints...');
    
    const constrainedItems: PlanItem[] = [];
    let totalCost = 0;
    let totalUnits = 0;
    
    // Get current warehouse capacity (assuming warehouse 11 for now)
    const warehouseCapacity = this.getCurrentWarehouseCapacity(11);
    console.log(`🏭 Warehouse capacity: ${warehouseCapacity} units`);
    
    for (const item of plan.items) {
      // Apply warehouse capacity constraint
      const constrainedQuantity = Math.min(item.quantity, warehouseCapacity);
      
      if (constrainedQuantity > 0) {
        const constrainedItem = {
          ...item,
          quantity: constrainedQuantity,
          totalCost: constrainedQuantity * item.unitCost
        };
        
        constrainedItems.push(constrainedItem);
        totalCost += constrainedItem.totalCost;
        totalUnits += constrainedQuantity;
        
        if (constrainedQuantity < item.quantity) {
          console.log(`⚠️ Item ${item.itemName} quantity reduced from ${item.quantity} to ${constrainedQuantity} due to warehouse capacity`);
        }
      }
    }
    
    // Add risk agent message
    this.addChatMessage(state, 'risk', `Applied warehouse capacity constraints. Final plan: $${totalCost.toLocaleString()} for ${totalUnits} units within ${warehouseCapacity} unit capacity.`);
    if (updateState) updateState();
    
    return {
      items: constrainedItems,
      totalCost,
      totalUnits,
      reasoning: `Warehouse capacity constraints applied (max ${warehouseCapacity} units)`
    };
  }

  private async finalAgentConsensusRefined(state: WorkflowState, updateState?: () => void) {
    console.log('🤝 Final Agent Consensus: Supply planning output...');
    
    if (!this.model) {
      console.log('🔄 FALLBACK: Skipping final consensus - no AI available');
      this.addChatMessage(state, 'risk', 'Final supply planning output ready.');
      return;
    }

    try {
      const plan = state.purchasePlan!;
      const finalPrompt = `As agents reaching final consensus on supply planning output: $${plan.totalCost.toLocaleString()} total cost, ${plan.totalUnits} units across ${plan.items.length} items. Provide a final 1-2 sentence summary of the optimized supply plan.`;
      
      this.addChatMessage(state, 'demand', 'Finalizing demand analysis...', true);
      if (updateState) updateState();
      await new Promise(resolve => setTimeout(resolve, 600));
      
      this.addChatMessage(state, 'purchasing', 'Completing newsvendor optimization...', true);
      if (updateState) updateState();
      await new Promise(resolve => setTimeout(resolve, 600));
      
      const consensusResponse = await this.model.generateContent(finalPrompt);
      const consensusText = await consensusResponse.response.text();
      this.addChatMessage(state, 'risk', consensusText.trim());
      if (updateState) updateState();
      
      await new Promise(resolve => setTimeout(resolve, 500));
      this.addChatMessage(state, 'demand', 'Supply planning output finalized.');
      if (updateState) updateState();
      
    } catch (error) {
      console.log('🔄 FALLBACK: Final consensus discussion failed, using simple message');
      this.addChatMessage(state, 'risk', 'Final supply planning output ready.');
    }
  }

  /**
   * Legacy methods for backward compatibility
   */
  private async analyzeDemand(predictions: any[], policy: SimplePolicy, state: WorkflowState, updateState?: () => void, allPredictions?: any[]): Promise<DemandResult[]> {
    const results = await this.analyzeDemandOriginal(predictions, policy, allPredictions);
    await this.discussDemandResults(state, results, updateState);
    return results;
  }

  private async generatePurchasePlan(demandResults: DemandResult[], policy: SimplePolicy, state: WorkflowState, updateState?: () => void): Promise<SimplePlan> {
    const plan = await this.generatePurchasePlanOriginal(demandResults, policy);
    await this.discussPurchasePlan(state, plan, policy, updateState);
    return plan;
  }

  // Rename original methods
  private async analyzeDemandOriginal(predictions: any[], policy: SimplePolicy, allPredictions?: any[]): Promise<DemandResult[]> {
    console.log('🔍 Analyzing demand for', predictions.length, 'predictions');
    console.log('📋 Sample prediction:', predictions[0]);
    const results: DemandResult[] = [];

    for (let i = 0; i < predictions.length; i++) {
      const pred = predictions[i];
      console.log(`🔄 Processing item ${i + 1}/${predictions.length}: ${pred.name}`);
      
      const confidence = this.calculateConfidence(pred);
      const targetQuantity = this.calculateTarget(pred, confidence, policy);
      console.log(`📊 Calculated confidence: ${(confidence * 100).toFixed(1)}%, target: ${targetQuantity}`);
      
      // Get historical data for this item (excluding the current/newest record)
      let historicalData: any[] = [];
      if (allPredictions) {
        historicalData = allPredictions
          .filter(p => p.item_id === pred.item_id)
          .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
          .slice(1); // Skip the first (newest) record
      }
      
      let reasoning = '';
      if (this.model) {
        try {
          console.log(`🤖 Calling AI for reasoning on ${pred.name}...`);
          const startTime = Date.now();
          reasoning = await this.getAIReasoning(pred, confidence, targetQuantity, historicalData);
          const duration = Date.now() - startTime;
          console.log(`⏱️ AI call completed in ${duration}ms`);
        } catch (error) {
          console.log('🔄 FALLBACK: Using local reasoning for', pred.name, 'Error:', error);
          reasoning = this.getFallbackReasoning(pred, confidence, targetQuantity);
        }
      } else {
        console.log('🔄 FALLBACK: No AI available, using local reasoning for', pred.name);
        reasoning = this.getFallbackReasoning(pred, confidence, targetQuantity);
      }

      results.push({
        itemId: pred.item_id,
        itemName: pred.name,
        targetQuantity,
        confidence,
        reasoning
      });
      console.log(`✅ Completed processing ${pred.name}`);
    }

    return results;
  }

  private async generatePurchasePlanOriginal(demandResults: DemandResult[], policy: SimplePolicy): Promise<SimplePlan> {
    const items: PlanItem[] = [];
    let totalCost = 0;
    let totalUnits = 0;

    demandResults.forEach(demand => {
      // Extract product ID from item_id (format: "32/11/10530" -> "10530")
      const productId = demand.itemId.split('/').pop() || demand.itemId;
      const skuCost = this.skuCostData[productId];
      
      // Use shortage cost as unit cost (revenue maximization focus)
      // Higher shortage cost = higher priority for purchasing
      const unitCost = skuCost ? skuCost.shortageCost : 100;
      const itemTotalCost = demand.targetQuantity * unitCost;
      
      items.push({
        itemId: demand.itemId,
        itemName: demand.itemName,
        quantity: demand.targetQuantity,
        unitCost,
        totalCost: itemTotalCost
      });

      totalCost += itemTotalCost;
      totalUnits += demand.targetQuantity;
    });

    let reasoning = '';
    if (this.model) {
      try {
        reasoning = await this.getPlanReasoning(items, totalCost, policy);
      } catch (error) {
        console.log('🔄 FALLBACK: Using local plan reasoning');
        reasoning = this.getFallbackPlanReasoning(items, totalCost, policy);
      }
    } else {
      console.log('🔄 FALLBACK: No AI available, using local plan reasoning');
      reasoning = this.getFallbackPlanReasoning(items, totalCost, policy);
    }

    return {
      items,
      totalCost,
      totalUnits,
      reasoning
    };
  }
}
