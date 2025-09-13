import React, { useState, useEffect, useRef, useMemo } from 'react';
import { SimpleWorkflowService } from '../services/simpleWorkflowService';
import type { WorkflowState, SimplePolicy, HumanInput } from '../types/workflow';

interface SimpleWorkflowPanelProps {
  itemIds: string[];
}

const SimpleWorkflowPanel: React.FC<SimpleWorkflowPanelProps> = ({ itemIds }) => {
  const [isRunning, setIsRunning] = useState(false);
  const [result, setResult] = useState<WorkflowState | null>(null);
  const [humanFeedback, setHumanFeedback] = useState('');
  const [isProcessingInput, setIsProcessingInput] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const workflowService = useMemo(() => new SimpleWorkflowService(), []);
  
  const [policy, setPolicy] = useState<SimplePolicy>({
    conservatismLevel: 'medium',
    maxCost: workflowService.getMaxBudget()
  });

  // Update policy when budget data loads
  useEffect(() => {
    const updateBudget = () => {
      const currentBudget = workflowService.getMaxBudget();
      if (currentBudget !== policy.maxCost) {
        setPolicy(prev => ({ ...prev, maxCost: currentBudget }));
      }
    };
    
    // Update immediately and then periodically check
    updateBudget();
    const interval = setInterval(updateBudget, 1000);
    
    return () => clearInterval(interval);
  }, [workflowService, policy.maxCost]);

  // Auto-scroll chat to bottom
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [result?.agentChat]);

  // Debug showResults state
  useEffect(() => {
    if (result) {
      console.log('🔍 UI: showResults state changed', { 
        showResults: result.showResults, 
        hasPlan: !!result.purchasePlan,
        resultsCount: result.demandResults?.length || 0,
        status: result.status
      });
    }
  }, [result?.showResults, result?.purchasePlan, result?.demandResults, result?.status]);

  const runWorkflow = async () => {
    setIsRunning(true);
    setResult(null);
    setHumanFeedback('');

    try {
      const workflowResult = await workflowService.runWorkflow(
        itemIds, 
        policy, 
        (updatedState) => {
          setResult(updatedState);
        }
      );
      setResult(workflowResult);
    } catch (error) {
      console.error('Workflow error:', error);
    } finally {
      setIsRunning(false);
    }
  };

  const submitHumanInput = async () => {
    if (!result || !humanFeedback.trim()) return;

    setIsProcessingInput(true);
    
    const humanInput: HumanInput = {
      feedback: humanFeedback.trim(),
      adjustments: {
        riskLevel: policy.conservatismLevel,
        budgetAdjustment: policy.maxCost
      }
    };

    try {
      const updatedResult = await workflowService.processHumanInput(
        result,
        humanInput,
        (updatedState) => {
          setResult(updatedState);
        }
      );
      setResult(updatedResult);
      setHumanFeedback('');
    } catch (error) {
      console.error('Error processing human input:', error);
    } finally {
      setIsProcessingInput(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submitHumanInput();
    }
  };

  return (
    <div className="simple-workflow">
      <div className="workflow-header">
        <h3>Supply Chain Workflow</h3>
      </div>

      <div className="policy-controls">
        <div className="control-group">
          <label>Risk Level:</label>
          <select 
            value={policy.conservatismLevel} 
            onChange={(e) => setPolicy({...policy, conservatismLevel: e.target.value as any})}
            disabled={isRunning}
          >
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
        </div>
        
        <div className="control-group">
          <label>Current Budget:</label>
          <div className="budget-display">
            ${workflowService.getMaxBudget().toLocaleString()}
          </div>
        </div>

        <button 
          onClick={runWorkflow}
          disabled={isRunning}
          className="run-workflow-btn"
        >
          {isRunning ? 'Running...' : 'Run Workflow'}
        </button>
      </div>

      {result && (
        <div className="workflow-results">
          <div className="status-bar">
            <span className={`status ${result.status}`}>
              {result.status === 'complete' ? 'Complete' : 
               result.status === 'waiting_for_input' ? 'Awaiting Input' : 'Running'}
            </span>
          </div>


          {result.agentChat.length > 0 && (
            <div className="agent-chat-section">
              <h4>Agent Discussion</h4>
              <div className="agent-chat-box">
                {result.agentChat.map((chat) => (
                  <div key={chat.id} className={`chat-bubble ${chat.agent} ${chat.isThinking ? 'thinking' : ''}`}>
                    <div className="agent-avatar">
                      {chat.agent === 'demand' ? 'D' : 
                       chat.agent === 'purchasing' ? 'P' : 
                       chat.agent === 'risk' ? 'R' : '👤'}
                    </div>
                    <div className="chat-content">
                      <div className="agent-name">
                        {chat.agent === 'demand' ? 'Demand' : 
                         chat.agent === 'purchasing' ? 'Purchasing' : 
                         chat.agent === 'risk' ? 'Risk' : 'Human'}
                        {chat.isThinking && <span className="thinking-indicator">...</span>}
                      </div>
                      <div className="chat-message">{chat.message}</div>
                    </div>
                  </div>
                ))}
                {isRunning && (
                  <div className="chat-bubble thinking">
                    <div className="agent-avatar">...</div>
                    <div className="chat-content">
                      <div className="agent-name">System</div>
                      <div className="chat-message">Agents are working...</div>
                    </div>
                  </div>
                )}
                
                {result.awaitingHumanInput && (
                  <div className="human-input-chat">
                    <div className="chat-bubble human-input">
                      <div className="agent-avatar">👤</div>
                      <div className="chat-content">
                        <div className="agent-name">You</div>
                        <div className="human-input-form">
                          <textarea
                            value={humanFeedback}
                            onChange={(e) => setHumanFeedback(e.target.value)}
                            onKeyDown={handleKeyDown}
                            placeholder="Provide your feedback on the proposed plan..."
                            className="chat-textarea"
                            rows={3}
                            disabled={isProcessingInput}
                          />
                          <button
                            onClick={submitHumanInput}
                            disabled={!humanFeedback.trim() || isProcessingInput}
                            className="chat-submit-btn"
                          >
                            {isProcessingInput ? 'Sending...' : 'Send'}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
                
                <div ref={chatEndRef} />
              </div>
            </div>
          )}

          <div className="messages">
            {result.messages.map((msg, index) => (
              <div key={index} className="message">{msg}</div>
            ))}
          </div>

          {result.showResults && result.purchasePlan && (
            <div className="purchase-plan">
              <h4>Purchase Plan</h4>
              <div className="plan-summary">
                <div className="summary-item">
                  <span className="label">Total Cost</span>
                  <span className="value">${result.purchasePlan.totalCost.toLocaleString()}</span>
                </div>
                <div className="summary-item">
                  <span className="label">Total Units</span>
                  <span className="value">{result.purchasePlan.totalUnits}</span>
                </div>
              </div>
              <div className="plan-reasoning">{result.purchasePlan.reasoning}</div>
              
              <div className="plan-items">
                {result.purchasePlan.items.map(item => (
                  <div key={item.itemId} className="plan-item">
                    <span className="item-name">{item.itemName}</span>
                    <span className="quantity">{item.quantity} × ${item.unitCost}</span>
                    <span className="total">${item.totalCost.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default SimpleWorkflowPanel;
