/**
 * HTTP Bridge para conectar AWS Lambda con el servidor MCP de FiscAI
 * Este módulo extiende la funcionalidad Lambda para incluir llamadas al servidor MCP
 */

const https = require('https');
const http = require('http');

// URL del servidor MCP desplegado
const MCP_SERVER_URL = process.env.MCP_SERVER_URL || '';

/**
 * Realiza una petición HTTP/HTTPS
 */
function makeHttpRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const protocol = urlObj.protocol === 'https:' ? https : http;
    
    const reqOptions = {
      hostname: urlObj.hostname,
      port: urlObj.port,
      path: urlObj.pathname + urlObj.search,
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        'User-Agent': 'FiscAI-Lambda-Bridge',
        ...options.headers
      }
    };

    const req = protocol.request(reqOptions, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        try {
          // Si el Content-Type es text/event-stream, parsear como SSE
          const contentType = res.headers['content-type'] || '';
          if (contentType.includes('text/event-stream')) {
            // Parsear formato SSE: "event: message\ndata: {json}\n\n"
            const lines = data.trim().split('\n');
            let jsonData = '';
            
            for (const line of lines) {
              if (line.startsWith('data: ')) {
                jsonData = line.substring(6); // Remove "data: " prefix
                break;
              }
            }
            
            if (jsonData) {
              const parsed = JSON.parse(jsonData);
              resolve({
                statusCode: res.statusCode,
                headers: res.headers,
                body: parsed
              });
              return;
            }
          }
          
          // Parsear como JSON normal
          const parsed = JSON.parse(data);
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: parsed
          });
        } catch (e) {
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: data
          });
        }
      });
    });
    
    req.on('error', reject);
    
    if (options.body) {
      req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
    }
    
    req.end();
  });
}

/**
 * Llama una herramienta del servidor MCP
 */
async function callMcpTool(toolName, toolArgs) {
  try {
    console.log(`[MCP] Llamando herramienta: ${toolName}`);
    console.log(`[MCP] Arguments:`, JSON.stringify(toolArgs));
    
    // FastMCP usa el protocolo MCP nativo vía POST /mcp/v1/tools/call
    // o simplemente POST con el formato JSON-RPC
    const mcpRequest = {
      jsonrpc: '2.0',
      id: `call-${Date.now()}`,
      method: 'tools/call',
      params: {
        name: toolName,
        arguments: toolArgs
      }
    };
    
    // Intentar con endpoint /mcp que requiere Accept: application/json, text/event-stream
    const response = await makeHttpRequest(`${MCP_SERVER_URL}/mcp`, {
      method: 'POST',
      body: mcpRequest,
      headers: {
        'Accept': 'application/json, text/event-stream',
        'Content-Type': 'application/json'
      }
    });
    
    console.log(`[MCP] Response status:`, response.statusCode);
    console.log(`[MCP] Response body:`, JSON.stringify(response.body));
    
    if (response.statusCode === 200) {
      // Si la respuesta tiene result, extraerlo
      if (response.body.result) {
        return response.body.result;
      }
      // Si es directamente el resultado
      return response.body;
    }
    
    // Si el error es por SSE, intentar sin SSE
    if (response.body.error && response.body.error.code === -32600) {
      console.log(`[MCP] Intentando con método alternativo...`);
      return await callMcpAlternative(toolName, toolArgs);
    }
    
    throw new Error(`Error MCP: ${JSON.stringify(response.body)}`);
    
  } catch (error) {
    console.error(`[MCP] Error llamando herramienta ${toolName}:`, error);
    throw new Error(`Error conectando con MCP: ${error.message}`);
  }
}

/**
 * Método alternativo: llamar directamente sin protocolo JSON-RPC
 */
async function callMcpAlternative(toolName, toolArgs) {
  console.log(`[MCP] Usando método alternativo para ${toolName}`);
  
  // Intentar endpoint directo REST-like
  const restUrl = `${MCP_SERVER_URL}/tools/${toolName}/call`;
  
  const response = await makeHttpRequest(restUrl, {
    method: 'POST',
    body: toolArgs,
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    }
  });
  
  if (response.statusCode === 200) {
    return response.body;
  }
  
  throw new Error(`Error en método alternativo: ${JSON.stringify(response.body)}`);
}


// ========== HANDLERS MCP ==========

/**
 * Handler para get_fiscal_advice vía MCP
 */
async function handleMcpFiscalAdvice(params) {
  const {
    actividad,
    ingresos_anuales,
    estado,
    regimen_actual,
    tiene_rfc,
    contexto_adicional
  } = params;

  if (!actividad) {
    return {
      statusCode: 400,
      body: {
        error: 'Falta el parámetro "actividad"',
        required: ['actividad'],
        optional: ['ingresos_anuales', 'estado', 'regimen_actual', 'tiene_rfc', 'contexto_adicional']
      }
    };
  }

  try {
    // FastMCP espera los parámetros envueltos en un objeto 'request'
    const result = await callMcpTool('get_fiscal_advice', {
      request: {
        actividad,
        ingresos_anuales,
        estado,
        regimen_actual,
        tiene_rfc,
        contexto_adicional
      }
    });

    return {
      statusCode: 200,
      body: {
        success: true,
        data: result,
        source: 'mcp_server',
        timestamp: new Date().toISOString()
      }
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: {
        error: error.message,
        timestamp: new Date().toISOString()
      }
    };
  }
}

/**
 * Handler para generate_embedding vía MCP
 */
async function handleMcpGenerateEmbedding(params) {
  const { text } = params;

  if (!text || !text.trim()) {
    return {
      statusCode: 400,
      body: {
        error: 'Falta el parámetro "text" o está vacío',
        required: ['text'],
        hint: 'El texto no puede estar vacío para generar el embedding'
      }
    };
  }

  try {
    console.log(`[MCP] Generando embedding para texto de ${text.length} caracteres`);
    console.log(`[MCP] Preview: ${text.substring(0, 50)}${text.length > 50 ? '...' : ''}`);

    // Llamar al tool generate_embedding del servidor MCP
    const result = await callMcpTool('generate_embedding', {
      text: text
    });

    return {
      statusCode: 200,
      body: {
        success: true,
        data: result,
        source: 'mcp_server',
        timestamp: new Date().toISOString(),
        metadata: {
          text_length: text.length,
          text_preview: text.substring(0, 100) + (text.length > 100 ? '...' : '')
        }
      }
    };
  } catch (error) {
    console.error(`[MCP] Error generando embedding:`, error);
    
    return {
      statusCode: 500,
      body: {
        error: error.message,
        timestamp: new Date().toISOString(),
        hint: 'Verifica que el servidor MCP esté funcionando y que la API de Gemini esté configurada correctamente'
      }
    };
  }
}

/**
 * Handler para store_document vía MCP
 */
async function handleMcpStoreDocument(params) {
  const { text, classroom_id } = params;

  if (!text || !text.trim()) {
    return {
      statusCode: 400,
      body: {
        error: 'Falta el parámetro "text" o está vacío',
        required: ['text'],
        optional: ['classroom_id'],
        hint: 'El texto del documento no puede estar vacío'
      }
    };
  }

  try {
    console.log(`[MCP] Almacenando documento de ${text.length} caracteres`);
    console.log(`[MCP] Classroom ID: ${classroom_id || 'None (global)'}`);
    console.log(`[MCP] Preview: ${text.substring(0, 50)}${text.length > 50 ? '...' : ''}`);

    // Llamar al tool store_document del servidor MCP
    const result = await callMcpTool('store_document', {
      text: text,
      classroom_id: classroom_id || null
    });

    return {
      statusCode: 200,
      body: {
        success: true,
        data: result,
        source: 'mcp_server',
        timestamp: new Date().toISOString(),
        metadata: {
          text_length: text.length,
          classroom_id: classroom_id || null,
          text_preview: text.substring(0, 100) + (text.length > 100 ? '...' : '')
        }
      }
    };
  } catch (error) {
    console.error(`[MCP] Error almacenando documento:`, error);
    
    return {
      statusCode: 500,
      body: {
        error: error.message,
        timestamp: new Date().toISOString(),
        hint: 'Verifica que el servidor MCP esté funcionando y que Supabase esté configurado correctamente'
      }
    };
  }
}

/**
 * Handler para search_similar_documents vía MCP
 */
async function handleMcpSearchSimilarDocuments(params) {
  const { 
    query_text, 
    classroom_id, 
    limit = 5, 
    threshold 
  } = params;

  if (!query_text || !query_text.trim()) {
    return {
      statusCode: 400,
      body: {
        error: 'Falta el parámetro "query_text" o está vacío',
        required: ['query_text'],
        optional: ['classroom_id', 'limit', 'threshold'],
        hint: 'El texto de consulta no puede estar vacío'
      }
    };
  }

  // Validar limit
  const parsedLimit = parseInt(limit);
  if (isNaN(parsedLimit) || parsedLimit < 1 || parsedLimit > 50) {
    return {
      statusCode: 400,
      body: {
        error: 'El parámetro "limit" debe ser un número entre 1 y 50',
        received: limit,
        hint: 'Usa un valor numérico válido para limitar los resultados'
      }
    };
  }

  // Validar threshold si se proporciona
  if (threshold !== undefined) {
    const parsedThreshold = parseFloat(threshold);
    if (isNaN(parsedThreshold) || parsedThreshold < 0 || parsedThreshold > 1) {
      return {
        statusCode: 400,
        body: {
          error: 'El parámetro "threshold" debe ser un número entre 0 y 1',
          received: threshold,
          hint: 'El threshold representa la similitud mínima (0=cualquier similitud, 1=idéntico)'
        }
      };
    }
  }

  try {
    console.log(`[MCP] Buscando documentos similares`);
    console.log(`[MCP] Query: "${query_text.substring(0, 50)}${query_text.length > 50 ? '...' : ''}"`);
    console.log(`[MCP] Classroom ID: ${classroom_id || 'None (búsqueda global)'}`);
    console.log(`[MCP] Limit: ${parsedLimit}`);
    console.log(`[MCP] Threshold: ${threshold || 'default'}`);

    // Preparar parámetros para MCP
    const mcpParams = {
      query_text: query_text,
      limit: parsedLimit
    };

    if (classroom_id) {
      mcpParams.classroom_id = classroom_id;
    }

    if (threshold !== undefined) {
      mcpParams.threshold = parseFloat(threshold);
    }

    // Llamar al tool search_similar_documents del servidor MCP
    const result = await callMcpTool('search_similar_documents', mcpParams);

    return {
      statusCode: 200,
      body: {
        success: true,
        data: result,
        source: 'mcp_server',
        timestamp: new Date().toISOString(),
        metadata: {
          query_length: query_text.length,
          query_preview: query_text.substring(0, 100) + (query_text.length > 100 ? '...' : ''),
          classroom_id: classroom_id || null,
          limit_used: parsedLimit,
          threshold_used: threshold || 'default'
        }
      }
    };
  } catch (error) {
    console.error(`[MCP] Error buscando documentos similares:`, error);
    
    return {
      statusCode: 500,
      body: {
        error: error.message,
        timestamp: new Date().toISOString(),
        hint: 'Verifica que el servidor MCP esté funcionando y que las funciones de Supabase estén configuradas'
      }
    };
  }
}

/**
 * Handler para store_document_chunk vía MCP
 */
async function handleMcpStoreDocumentChunk(params) {
  const { 
    classroom_document_id,
    chunk_index,
    content,
    token_count
  } = params;

  if (!classroom_document_id || !classroom_document_id.trim()) {
    return {
      statusCode: 400,
      body: {
        error: 'Falta el parámetro "classroom_document_id"',
        required: ['classroom_document_id', 'chunk_index', 'content'],
        optional: ['token_count'],
        hint: 'El ID del documento es obligatorio'
      }
    };
  }

  if (chunk_index === undefined || chunk_index === null) {
    return {
      statusCode: 400,
      body: {
        error: 'Falta el parámetro "chunk_index"',
        required: ['classroom_document_id', 'chunk_index', 'content'],
        hint: 'El índice del chunk es obligatorio (0, 1, 2, ...)'
      }
    };
  }

  if (!content || !content.trim()) {
    return {
      statusCode: 400,
      body: {
        error: 'Falta el parámetro "content" o está vacío',
        required: ['classroom_document_id', 'chunk_index', 'content'],
        hint: 'El contenido del chunk no puede estar vacío'
      }
    };
  }

  try {
    console.log(`[MCP] Almacenando chunk de documento`);
    console.log(`[MCP] Document ID: ${classroom_document_id}`);
    console.log(`[MCP] Chunk Index: ${chunk_index}`);
    console.log(`[MCP] Content length: ${content.length} caracteres`);
    console.log(`[MCP] Token count: ${token_count || 'auto'}`);

    // Llamar al tool store_document_chunk del servidor MCP
    const result = await callMcpTool('store_document_chunk', {
      classroom_document_id,
      chunk_index: parseInt(chunk_index),
      content,
      token_count: token_count ? parseInt(token_count) : undefined
    });

    return {
      statusCode: 200,
      body: {
        success: true,
        data: result,
        source: 'mcp_server',
        timestamp: new Date().toISOString(),
        metadata: {
          classroom_document_id,
          chunk_index: parseInt(chunk_index),
          content_length: content.length,
          token_count: token_count || 'auto'
        }
      }
    };
  } catch (error) {
    console.error(`[MCP] Error almacenando chunk:`, error);
    
    return {
      statusCode: 500,
      body: {
        error: error.message,
        timestamp: new Date().toISOString(),
        hint: 'Verifica que el documento exista y que Supabase esté configurado correctamente'
      }
    };
  }
}

/**
 * Handler para search_similar_chunks vía MCP
 */
async function handleMcpSearchSimilarChunks(params) {
  const { 
    query_text,
    classroom_id,
    limit = 5,
    threshold
  } = params;

  if (!query_text || !query_text.trim()) {
    return {
      statusCode: 400,
      body: {
        error: 'Falta el parámetro "query_text" o está vacío',
        required: ['query_text', 'classroom_id'],
        optional: ['limit', 'threshold'],
        hint: 'El texto de consulta no puede estar vacío'
      }
    };
  }

  if (!classroom_id || !classroom_id.trim()) {
    return {
      statusCode: 400,
      body: {
        error: 'Falta el parámetro "classroom_id"',
        required: ['query_text', 'classroom_id'],
        optional: ['limit', 'threshold'],
        hint: 'El ID del classroom es OBLIGATORIO para esta búsqueda'
      }
    };
  }

  try {
    console.log(`[MCP] Buscando chunks similares en classroom ${classroom_id}`);
    console.log(`[MCP] Query: "${query_text.substring(0, 50)}${query_text.length > 50 ? '...' : ''}"`);
    console.log(`[MCP] Limit: ${limit}`);
    console.log(`[MCP] Threshold: ${threshold || 'default'}`);

    // Llamar al tool search_similar_chunks del servidor MCP
    const result = await callMcpTool('search_similar_chunks', {
      query_text,
      classroom_id,
      limit: parseInt(limit),
      threshold: threshold ? parseFloat(threshold) : undefined
    });

    return {
      statusCode: 200,
      body: {
        success: true,
        data: result,
        source: 'mcp_server',
        timestamp: new Date().toISOString(),
        metadata: {
          query_text,
          classroom_id,
          limit: parseInt(limit),
          threshold: threshold || 'default'
        }
      }
    };
  } catch (error) {
    console.error(`[MCP] Error buscando chunks:`, error);
    
    return {
      statusCode: 500,
      body: {
        error: error.message,
        timestamp: new Date().toISOString(),
        hint: 'Verifica que el classroom exista y que la función RPC match_classroom_chunks esté creada'
      }
    };
  }
}

/**
 * Handler para chat_with_classroom_assistant vía MCP
 */
async function handleMcpChatWithClassroom(params) {
  const {
    message,
    classroom_id,
    user_id,
    session_id
  } = params;

  if (!message || !message.trim()) {
    return {
      statusCode: 400,
      body: {
        error: 'Falta el parámetro "message" o está vacío',
        required: ['message', 'classroom_id'],
        optional: ['user_id', 'session_id'],
        hint: 'El mensaje del usuario no puede estar vacío'
      }
    };
  }

  if (!classroom_id || !classroom_id.trim()) {
    return {
      statusCode: 400,
      body: {
        error: 'Falta el parámetro "classroom_id"',
        required: ['message', 'classroom_id'],
        optional: ['user_id', 'session_id'],
        hint: 'El ID del classroom es obligatorio'
      }
    };
  }

  try {
    console.log(`[MCP] Chat con asistente de classroom`);
    console.log(`[MCP] Message: "${message.substring(0, 50)}${message.length > 50 ? '...' : ''}"`);
    console.log(`[MCP] Classroom ID: ${classroom_id}`);
    console.log(`[MCP] User ID: ${user_id || 'Anonymous'}`);
    console.log(`[MCP] Session ID: ${session_id || 'N/A'}`);

    // Llamar al tool chat_with_classroom_assistant del servidor MCP
    const result = await callMcpTool('chat_with_classroom_assistant', {
      request: {
        message,
        classroom_id,
        user_id: user_id || null,
        session_id: session_id || null
      }
    });

    return {
      statusCode: 200,
      body: {
        success: true,
        data: result,
        source: 'mcp_server',
        timestamp: new Date().toISOString(),
        metadata: {
          message_length: message.length,
          classroom_id,
          user_id: user_id || 'anonymous',
          session_id: session_id || 'none'
        }
      }
    };
  } catch (error) {
    console.error(`[MCP] Error en chat con asistente:`, error);
    
    return {
      statusCode: 500,
      body: {
        error: error.message,
        timestamp: new Date().toISOString(),
        hint: 'Verifica que el classroom exista y tenga documentos cargados'
      }
    };
  }
}

/**
 * Handler para get_classroom_info vía MCP
 */
async function handleMcpGetClassroomInfo(params) {
  const { classroom_id } = params;

  if (!classroom_id || !classroom_id.trim()) {
    return {
      statusCode: 400,
      body: {
        error: 'Falta el parámetro "classroom_id"',
        required: ['classroom_id'],
        hint: 'El ID del classroom es obligatorio'
      }
    };
  }

  try {
    console.log(`[MCP] Obteniendo información del classroom ${classroom_id}`);

    // Llamar al tool get_classroom_info del servidor MCP
    const result = await callMcpTool('get_classroom_info', {
      classroom_id
    });

    return {
      statusCode: 200,
      body: {
        success: true,
        data: result,
        source: 'mcp_server',
        timestamp: new Date().toISOString()
      }
    };
  } catch (error) {
    console.error(`[MCP] Error obteniendo información del classroom:`, error);
    
    return {
      statusCode: 500,
      body: {
        error: error.message,
        timestamp: new Date().toISOString(),
        hint: 'Verifica que el classroom exista'
      }
    };
  }
}

/**
 * Handler para create_embedding vía MCP
 */
async function handleMcpCreateEmbedding(params) {
  const { text, classroom_id } = params;

  if (!text || !text.trim()) {
    return {
      statusCode: 400,
      body: {
        error: 'Falta el parámetro "text" o está vacío',
        required: ['text', 'classroom_id'],
        hint: 'El texto no puede estar vacío'
      }
    };
  }

  if (!classroom_id || !classroom_id.trim()) {
    return {
      statusCode: 400,
      body: {
        error: 'Falta el parámetro "classroom_id"',
        required: ['text', 'classroom_id'],
        hint: 'El ID del classroom es obligatorio'
      }
    };
  }

  try {
    console.log(`[MCP] Creando embedding`);
    console.log(`[MCP] Text length: ${text.length} caracteres`);
    console.log(`[MCP] Classroom ID: ${classroom_id}`);

    // Llamar al tool create_embedding del servidor MCP
    const result = await callMcpTool('create_embedding', {
      text,
      classroom_id
    });

    return {
      statusCode: 200,
      body: {
        success: true,
        data: result,
        source: 'mcp_server',
        timestamp: new Date().toISOString(),
        metadata: {
          text_length: text.length,
          classroom_id
        }
      }
    };
  } catch (error) {
    console.error(`[MCP] Error creando embedding:`, error);
    
    return {
      statusCode: 500,
      body: {
        error: error.message,
        timestamp: new Date().toISOString(),
        hint: 'Verifica la configuración de Gemini y Supabase'
      }
    };
  }
}

/**
 * Handler para professor_assistant vía MCP
 */
async function handleMcpProfessorAssistant(params) {
  const { question, classroom_id } = params;

  if (!question || !question.trim()) {
    return {
      statusCode: 400,
      body: {
        error: 'Falta el parámetro "question" o está vacío',
        required: ['question', 'classroom_id'],
        hint: 'La pregunta no puede estar vacía'
      }
    };
  }

  if (!classroom_id || !classroom_id.trim()) {
    return {
      statusCode: 400,
      body: {
        error: 'Falta el parámetro "classroom_id"',
        required: ['question', 'classroom_id'],
        hint: 'El ID del classroom es obligatorio'
      }
    };
  }

  try {
    console.log(`[MCP] Consultando al profesor asistente`);
    console.log(`[MCP] Question: "${question.substring(0, 60)}${question.length > 60 ? '...' : ''}"`);
    console.log(`[MCP] Classroom ID: ${classroom_id}`);

    // Llamar al tool professor_assistant del servidor MCP
    const result = await callMcpTool('professor_assistant', {
      question,
      classroom_id
    });

    return {
      statusCode: 200,
      body: {
        success: true,
        data: result,
        source: 'mcp_server',
        timestamp: new Date().toISOString(),
        metadata: {
          question_length: question.length,
          classroom_id
        }
      }
    };
  } catch (error) {
    console.error(`[MCP] Error en professor assistant:`, error);
    
    return {
      statusCode: 500,
      body: {
        error: error.message,
        timestamp: new Date().toISOString(),
        hint: 'Verifica que el classroom tenga documentos cargados'
      }
    };
  }
}

/**
 * Handler para generate_resources vía MCP
 */
async function handleMcpGenerateResources(params) {
  const { 
    classroom_id,
    resource_type,
    user_id,
    topic,
    source_document_ids
  } = params;

  // Validaciones
  if (!classroom_id || !classroom_id.trim()) {
    return {
      statusCode: 400,
      body: {
        error: 'Falta el parámetro "classroom_id"',
        required: ['classroom_id', 'resource_type', 'user_id'],
        optional: ['topic', 'source_document_ids'],
        hint: 'El ID del classroom es obligatorio'
      }
    };
  }

  if (!resource_type || !resource_type.trim()) {
    return {
      statusCode: 400,
      body: {
        error: 'Falta el parámetro "resource_type"',
        required: ['classroom_id', 'resource_type', 'user_id'],
        optional: ['topic', 'source_document_ids'],
        hint: 'El tipo de recurso es obligatorio: "pdf" o "ppt"'
      }
    };
  }

  if (!['pdf', 'ppt'].includes(resource_type.toLowerCase())) {
    return {
      statusCode: 400,
      body: {
        error: 'Tipo de recurso inválido',
        received: resource_type,
        allowed: ['pdf', 'ppt'],
        hint: 'El tipo de recurso debe ser "pdf" o "ppt"'
      }
    };
  }

  if (!user_id || !user_id.trim()) {
    return {
      statusCode: 400,
      body: {
        error: 'Falta el parámetro "user_id"',
        required: ['classroom_id', 'resource_type', 'user_id'],
        optional: ['topic', 'source_document_ids'],
        hint: 'El ID del usuario es obligatorio'
      }
    };
  }

  try {
    console.log(`[MCP] Generando recurso educativo ${resource_type.toUpperCase()}`);
    console.log(`[MCP] Classroom ID: ${classroom_id}`);
    console.log(`[MCP] User ID: ${user_id}`);
    console.log(`[MCP] Topic: ${topic || 'General'}`);
    console.log(`[MCP] Source Documents: ${source_document_ids ? source_document_ids.length : 'all'}`);

    // Preparar parámetros para MCP
    const mcpParams = {
      classroom_id,
      resource_type: resource_type.toLowerCase(),
      user_id
    };

    if (topic) {
      mcpParams.topic = topic;
    }

    if (source_document_ids && Array.isArray(source_document_ids)) {
      mcpParams.source_document_ids = source_document_ids;
    }

    // Llamar al tool generate_resources del servidor MCP
    const result = await callMcpTool('generate_resources', mcpParams);

    return {
      statusCode: 200,
      body: {
        success: true,
        data: result,
        source: 'mcp_server',
        timestamp: new Date().toISOString(),
        metadata: {
          classroom_id,
          resource_type: resource_type.toLowerCase(),
          user_id,
          topic: topic || null
        }
      }
    };
  } catch (error) {
    console.error(`[MCP] Error generando recursos:`, error);
    
    return {
      statusCode: 500,
      body: {
        error: error.message,
        timestamp: new Date().toISOString(),
        hint: 'Verifica que el classroom tenga documentos cargados y que las dependencias de generación estén instaladas'
      }
    };
  }
}

/**
 * Handler para analyze_and_update_user_context vía MCP
 */
async function handleMcpAnalyzeUserContext(params) {
  const { user_id, session_id } = params;

  if (!user_id || !user_id.trim()) {
    return {
      statusCode: 400,
      body: {
        error: 'Falta el parámetro "user_id"',
        required: ['user_id', 'session_id'],
        hint: 'El ID del usuario es obligatorio'
      }
    };
  }

  if (!session_id || !session_id.trim()) {
    return {
      statusCode: 400,
      body: {
        error: 'Falta el parámetro "session_id"',
        required: ['user_id', 'session_id'],
        hint: 'El ID de la sesión es obligatorio'
      }
    };
  }

  try {
    console.log(`[MCP] Analizando contexto de usuario`);
    console.log(`[MCP] User ID: ${user_id}`);
    console.log(`[MCP] Session ID: ${session_id}`);

    // Llamar al tool analyze_and_update_user_context del servidor MCP
    const result = await callMcpTool('analyze_and_update_user_context', {
      user_id,
      session_id
    });

    return {
      statusCode: 200,
      body: {
        success: true,
        data: result,
        source: 'mcp_server',
        timestamp: new Date().toISOString(),
        metadata: {
          user_id,
          session_id
        }
      }
    };
  } catch (error) {
    console.error(`[MCP] Error analizando contexto de usuario:`, error);
    
    return {
      statusCode: 500,
      body: {
        error: error.message,
        timestamp: new Date().toISOString(),
        hint: 'Verifica que el usuario y la sesión existan'
      }
    };
  }
}

/**
 * Exportar los handlers MCP
 */
module.exports = {
  handleMcpFiscalAdvice,
  handleMcpGenerateEmbedding,
  handleMcpStoreDocument,
  handleMcpSearchSimilarDocuments,
  handleMcpStoreDocumentChunk,
  handleMcpSearchSimilarChunks,
  handleMcpChatWithClassroom,
  handleMcpGetClassroomInfo,
  handleMcpCreateEmbedding,
  handleMcpProfessorAssistant,
  handleMcpGenerateResources,
  handleMcpAnalyzeUserContext,
};
