export interface SimplePolicy {
  conservatismLevel: 'low' | 'medium' | 'high';
  maxCost: number;
}

export interface WorkflowState {
  status: 'ready' | 'running' | 'waiting_for_input' | 'complete';
  demandResults: DemandResult[];
  purchasePlan: SimplePlan | null;
  messages: string[];
  agentChat: AgentChatMessage[];
  awaitingHumanInput: boolean;
  humanInput?: HumanInput;
  showResults: boolean;
}

export interface HumanInput {
  feedback: string;
  adjustments: {
    riskLevel?: 'low' | 'medium' | 'high';
    budgetAdjustment?: number;
    itemOverrides?: ItemOverride[];
  };
}

export interface ItemOverride {
  itemId: string;
  originalQuantity: number;
  newQuantity: number;
  reason: string;
}

export interface AgentChatMessage {
  id: string;
  timestamp: string;
  agent: 'demand' | 'purchasing' | 'risk' | 'human';
  message: string;
  isThinking?: boolean;
}

export interface DemandResult {
  itemId: string;
  itemName: string;
  targetQuantity: number;
  confidence: number;
  reasoning: string;
}

export interface SimplePlan {
  items: PlanItem[];
  totalCost: number;
  totalUnits: number;
  reasoning: string;
}

export interface PlanItem {
  itemId: string;
  itemName: string;
  quantity: number;
  unitCost: number;
  totalCost: number;
}
