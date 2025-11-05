/**
 * FiscAI Lambda - MCP Bridge Only
 * Handler simplificado que solo expone endpoints conectados al servidor MCP
 */

const mcpBridge = require('./mcp_bridge');

// ========== UTILIDADES ==========

function extractParams(event) {
  let params = {};

  if (event.queryStringParameters) {
    params = { ...event.queryStringParameters };
  }
  
  if (event.body) {
    const body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
    params = { ...params, ...body };
  }
  
  if (!event.queryStringParameters && !event.body && !event.httpMethod) {
    params = { ...event };
  }

  return params;
}

function createResponse(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    },
    body: JSON.stringify(body)
  };
}

function getEndpoint(event) {
  // Extraer path de diferentes formatos de API Gateway
  let path = event.path || event.rawPath || event.requestContext?.resourcePath || '';
  
  // Normalizar path (remover trailing slash)
  path = path.replace(/\/$/, '');
  
  console.log(`[ROUTER] Path: ${path}`);
  
  // Mapeo de endpoints
  if (path.includes('/fiscal-advice') || path.includes('/fiscaladvice')) return 'fiscal-advice';
  if (path.includes('/generate-embedding') || path.includes('/embedding')) return 'generate-embedding';
  if (path.includes('/store-document-chunk') || path.includes('/store-chunk')) return 'store-document-chunk';
  if (path.includes('/search-chunks') || path.includes('/chunks')) return 'search-chunks';
  if (path.includes('/chat-classroom') || path.includes('/chat-classroom')) return 'chat-classroom';
  if (path.includes('/classroom-info') || path.includes('/classroom')) return 'classroom-info';
  if (path.includes('/create-embedding')) return 'create-embedding';
  if (path.includes('/professor-assistant') || path.includes('/professor')) return 'professor-assistant';
  if (path.includes('/generate-resources') || path.includes('/resources')) return 'generate-resources';
  if (path.includes('/analyze-user-context') || path.includes('/analyze-context')) return 'analyze-user-context';
  
  // Health check
  if (path.includes('/health')) return 'health';
  
  // Root o info
  if (path === '/' || path === '' || path === '/info') return 'info';
  
  return 'unknown';
}

// ========== HANDLER PRINCIPAL ==========

exports.handler = async (event, context) => {
  console.log('Event:', JSON.stringify(event, null, 2));
  
  // Manejar OPTIONS (CORS preflight)
  if (event.httpMethod === 'OPTIONS' || event.requestContext?.http?.method === 'OPTIONS') {
    return createResponse(200, { message: 'OK' });
  }

  try {
    const endpoint = getEndpoint(event);
    console.log(`[ROUTER] Endpoint detectado: ${endpoint}`);
    
    const params = extractParams(event);

    // Enrutamiento
    switch (endpoint) {
    
      
      // ========== ENDPOINTS MCP ==========
      
      case 'fiscal-advice': {
        console.log('[MCP] Llamando get_fiscal_advice...');
        const result = await mcpBridge.handleMcpFiscalAdvice(params);
        return createResponse(result.statusCode, result.body);
      }

      case 'generate-embedding': {
        console.log('[MCP] Llamando generate_embedding...');
        const result = await mcpBridge.handleMcpGenerateEmbedding(params);
        return createResponse(result.statusCode, result.body);
      }

      case 'store-document-chunk': {
        console.log('[MCP] Llamando store_document_chunk...');
        const result = await mcpBridge.handleMcpStoreDocumentChunk(params);
        return createResponse(result.statusCode, result.body);
      }

      case 'search-chunks': {
        console.log('[MCP] Llamando search_similar_chunks...');
        const result = await mcpBridge.handleMcpSearchSimilarChunks(params);
        return createResponse(result.statusCode, result.body);
      }

      case 'chat-classroom': {
        console.log('[MCP] Llamando chat_with_classroom_assistant...');
        const result = await mcpBridge.handleMcpChatWithClassroom(params);
        return createResponse(result.statusCode, result.body);
      }

      case 'classroom-info': {
        console.log('[MCP] Llamando get_classroom_info...');
        const result = await mcpBridge.handleMcpGetClassroomInfo(params);
        return createResponse(result.statusCode, result.body);
      }

      case 'create-embedding': {
        console.log('[MCP] Llamando create_embedding...');
        const result = await mcpBridge.handleMcpCreateEmbedding(params);
        return createResponse(result.statusCode, result.body);
      }

      case 'professor-assistant': {
        console.log('[MCP] Llamando professor_assistant...');
        const result = await mcpBridge.handleMcpProfessorAssistant(params);
        return createResponse(result.statusCode, result.body);
      }

      case 'generate-resources': {
        console.log('[MCP] Llamando generate_resources...');
        const result = await mcpBridge.handleMcpGenerateResources(params);
        return createResponse(result.statusCode, result.body);
      }

      case 'analyze-user-context': {
        console.log('[MCP] Llamando analyze_and_update_user_context...');
        const result = await mcpBridge.handleMcpAnalyzeUserContext(params);
        return createResponse(result.statusCode, result.body);
      }
      
      // ========== HEALTH CHECK ==========
      
      case 'health': {
        return createResponse(200, {
          status: 'healthy',
          service: 'FiscAI Lambda MCP Bridge',
          version: '2.0.0',
          mcp_server: process.env.MCP_SERVER_URL || 'https://fiscmcp.fastmcp.app',
          timestamp: new Date().toISOString()
        });
      }
      
      // ========== INFO / ROOT ==========
      
      case 'info': {
        return createResponse(200, {
          service: 'EstudIA Lambda - MCP Bridge',
          version: '3.0.0',
          description: 'Bridge HTTP para conectar apps con servidor MCP de EstudIA (Sistema de gestión educativa tipo NotebookLM)',
          mcp_server: process.env.MCP_SERVER_URL || 'https://estudia-mcp.fastmcp.app',
          endpoints: {
            health: '/health',
            // Embeddings
            generateEmbedding: '/generate-embedding',
            createEmbedding: '/create-embedding',
            // Documentos y Chunks
            storeDocumentChunk: '/store-document-chunk',
            searchChunks: '/search-chunks',
            // Asistentes
            chatClassroom: '/chat-classroom',
            professorAssistant: '/professor-assistant',
            // Classroom
            classroomInfo: '/classroom-info',
            generateResources: '/generate-resources',
            // Contexto de Usuario
            analyzeUserContext: '/analyze-user-context',
            // Legacy (FiscAI)
            fiscalAdvice: '/fiscal-advice',
          },
          usage: {
            generateEmbedding: {
              method: 'POST',
              path: '/generate-embedding',
              body: {
                text: 'string (required)'
              }
            },
            createEmbedding: {
              method: 'POST',
              path: '/create-embedding',
              body: {
                text: 'string (required)',
                classroom_id: 'string (required, UUID del classroom)'
              }
            },
            storeDocumentChunk: {
              method: 'POST',
              path: '/store-document-chunk',
              body: {
                classroom_document_id: 'string (required, UUID del documento)',
                chunk_index: 'number (required, índice del chunk: 0, 1, 2...)',
                content: 'string (required, contenido del chunk)',
                token_count: 'number (optional, número de tokens)'
              }
            },
            searchChunks: {
              method: 'POST',
              path: '/search-chunks',
              body: {
                query_text: 'string (required)',
                classroom_id: 'string (required, UUID del classroom)',
                limit: 'number (optional, default: 5)',
                threshold: 'number (optional, 0-1, default: 0.6)'
              }
            },
            chatClassroom: {
              method: 'POST',
              path: '/chat-classroom',
              body: {
                message: 'string (required, mensaje del usuario)',
                classroom_id: 'string (required, UUID del classroom)',
                user_id: 'string (optional, UUID del usuario)',
                session_id: 'string (optional, ID de sesión)'
              }
            },
            classroomInfo: {
              method: 'GET/POST',
              path: '/classroom-info',
              body: {
                classroom_id: 'string (required, UUID del classroom)'
              }
            },
            professorAssistant: {
              method: 'POST',
              path: '/professor-assistant',
              body: {
                question: 'string (required, pregunta del estudiante)',
                classroom_id: 'string (required, UUID del classroom)'
              }
            },
            generateResources: {
              method: 'POST',
              path: '/generate-resources',
              body: {
                classroom_id: 'string (required, UUID del classroom)',
                resource_type: 'string (required, "pdf" o "ppt")',
                user_id: 'string (required, UUID del usuario)',
                topic: 'string (optional, tema específico del recurso)',
                source_document_ids: 'array (optional, UUIDs de documentos específicos)'
              }
            },
            analyzeUserContext: {
              method: 'POST',
              path: '/analyze-user-context',
              body: {
                user_id: 'string (required, UUID del usuario)',
                session_id: 'string (required, UUID de la sesión del cubículo)'
              }
            },
            fiscalAdvice: {
              method: 'POST',
              path: '/fiscal-advice',
              body: {
                actividad: 'string (required)',
                ingresos_anuales: 'number (optional)',
                estado: 'string (optional)',
                regimen_actual: 'string (optional)',
                tiene_rfc: 'boolean (optional)',
                contexto_adicional: 'string (optional)'
              }
            },
          },
          examples: {
            chatClassroom: `
            curl -X POST https://your-api-url.com/chat-classroom \\
              -H "Content-Type: application/json" \\
              -d '{
                "message": "¿Cuáles son los conceptos clave de la clase?",
                "classroom_id": "550e8400-e29b-41d4-a716-446655440000"
              }'
            `.trim(),
            professorAssistant: `
            curl -X POST https://your-api-url.com/professor-assistant \\
              -H "Content-Type: application/json" \\
              -d '{
                "question": "¿Puedes explicar el concepto de embeddings?",
                "classroom_id": "550e8400-e29b-41d4-a716-446655440000"
              }'
            `.trim(),
            storeChunk: `
            curl -X POST https://your-api-url.com/store-document-chunk \\
              -H "Content-Type: application/json" \\
              -d '{
                "classroom_document_id": "doc-uuid-123",
                "chunk_index": 0,
                "content": "Los embeddings son vectores numéricos..."
              }'
            `.trim(),
            searchChunks: `
            curl -X POST https://your-api-url.com/search-chunks \\
              -H "Content-Type: application/json" \\
              -d '{
                "query_text": "embeddings vectores",
                "classroom_id": "550e8400-e29b-41d4-a716-446655440000",
                "limit": 5
              }'
            `.trim(),
            analyzeUserContext: `
            curl -X POST https://your-api-url.com/analyze-user-context \\
              -H "Content-Type: application/json" \\
              -d '{
                "user_id": "user-uuid-123",
                "session_id": "session-uuid-456"
              }'
            `.trim()
          },
          timestamp: new Date().toISOString()
        });
      }
      
      // ========== 404 ==========
      
      default: {
        return createResponse(404, {
          error: 'Endpoint no encontrado',
          endpoint_requested: endpoint,
          path: event.path || event.rawPath || 'N/A',
          method: event.httpMethod || event.requestContext?.http?.method || 'N/A',
          available_endpoints: [
            '/health',
            '/generate-embedding',
            '/create-embedding',
            '/store-document-chunk',
            '/search-chunks',
            '/chat-classroom',
            '/classroom-info',
            '/professor-assistant',
            '/generate-resources',
            '/analyze-user-context',
            '/fiscal-advice (legacy)',
          ],
          tip: 'Accede a / o /info para ver la documentación completa',
          timestamp: new Date().toISOString()
        });
      }
    }

  } catch (error) {
    console.error('[ERROR]', error);
    
    return createResponse(500, {
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
      timestamp: new Date().toISOString()
    });
  }
};
