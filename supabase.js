/* ============================
   Supabase Integration
   ============================ */

// Configuração do Supabase - substitua com suas credenciais
const SUPABASE_URL = 'https://sazudxbxvdxqefbjgysh.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNhenVkeGJ4dmR4cWVmYmpneXNoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA3MjY5MjIsImV4cCI6MjA4NjMwMjkyMn0.RKTGUDaCZin4aAkgzpXOU9b0Ghp3LDQXGSjvmZjd91o';

// Inicializar cliente Supabase
let supabaseClient;

function initSupabase() {
    try {
        console.log('🔍 Verificando window.supabase:', typeof window.supabase);
        
        // Usar createClient do window (do CDN)
        if (typeof window.supabase !== 'undefined' && window.supabase.createClient) {
            supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
            console.log('✅ Supabase inicializado');
            // Disponibilizar globalmente para testes
            window.supabaseClient = supabaseClient;
            return true;
        }
        
        // Fallback se não estiver disponível
        console.error('❌ Supabase não encontrado no window. Disponível:', Object.keys(window));
        return false;
    } catch (err) {
        console.error('❌ Erro ao inicializar Supabase:', err);
        return false;
    }
}

// Funções de Storage para arquivos
async function uploadFileToSupabase(file, fileName) {
    if (!supabaseClient) {
        throw new Error('Supabase não inicializado');
    }
    
    const fileExt = fileName.split('.').pop();
    const uniqueFileName = `${Date.now()}_${Math.random().toString(36).substr(2, 9)}.${fileExt}`;
    const filePath = `notas/${uniqueFileName}`;
    
    const { data, error } = await supabaseClient.storage
        .from('documentos')
        .upload(filePath, file);
    
    if (error) {
        throw new Error(`Erro ao fazer upload: ${error.message}`);
    }
    
    // Obter URL pública do arquivo
    const { data: { publicUrl } } = supabaseClient.storage
        .from('documentos')
        .getPublicUrl(filePath);
    
    return {
        path: filePath,
        publicUrl,
        name: fileName,
        size: file.size,
        type: file.type
    };
}

// Funções de Database para lançamentos
async function saveNotaToSupabase(notaData) {
    if (!supabaseClient) {
        throw new Error('Supabase não inicializado');
    }
    
    // Adaptar para sua estrutura de tabelas REAL
    const lancamentoData = {
        id: notaData.id,
        tipo: notaData.tipo,
        fornecedor: notaData.fornecedor,
        categoria: notaData.categoria,
        subcategoria: notaData.centro_custo || null,
        descricao: notaData.descricao || null,
        valor: notaData.valor,
        competencia: notaData.competencia,
        status: notaData.status,
        data_pagamento: notaData.pago_em || null,
        criado_por: null // Pode ser preenchido se tiver auth
    };
    
    console.log('🔍 Salvando no Supabase:', lancamentoData);
    
    const { data, error } = await supabaseClient
        .from('lancamentos')
        .insert([lancamentoData])
        .select();
    
    console.log('🔍 Resposta do Supabase:', { data, error });
    
    if (error) {
        throw new Error(`Erro ao salvar lançamento: ${error.message}`);
    }
    
    // Se tiver anexo, salvar na tabela anexos
    if (notaData.attachment_data) {
        await saveAnexoToSupabase(data[0].id, notaData.attachment_data);
    }
    
    // Converter formato para compatibilidade com frontend
    return adaptLancamentoToNota(data[0], notaData.attachment_data);
}

async function saveAnexoToSupabase(lancamentoId, attachmentData) {
    if (!supabase || !attachmentData) return;
    
    const anexoData = {
        lancamento_id: lancamentoId,
        arquivo_nome: attachmentData.name,
        arquivo_path: attachmentData.path,
        arquivo_url: attachmentData.publicUrl,
    };
    
    const { error } = await supabaseClient
        .from('anexos')
        .insert([anexoData]);
    
    if (error) {
        console.warn('Erro ao salvar anexo:', error);
    }
}

async function updateNotaInSupabase(id, updates) {
    if (!supabaseClient) {
        throw new Error('Supabase não inicializado');
    }
    
    // Adaptar updates para sua estrutura
    const lancamentoUpdates = {};
    if (updates.status) {
        lancamentoUpdates.status = updates.status;
    }
    if (updates.pago_em) {
        lancamentoUpdates.data_pagamento = updates.pago_em;
    }
    
    const { data, error } = await supabaseClient
        .from('lancamentos')
        .update(lancamentoUpdates)
        .eq('id', id)
        .select();
    
    if (error) {
        throw new Error(`Erro ao atualizar lançamento: ${error.message}`);
    }
    
    return adaptLancamentoToNota(data[0]);
}

async function deleteNotaFromSupabase(id) {
    if (!supabaseClient) {
        throw new Error('Supabase não inicializado');
    }
    
    // Primeiro excluir anexos relacionados
    const { error: anexoError } = await supabaseClient
        .from('anexos')
        .delete()
        .eq('lancamento_id', id);
    
    if (anexoError) {
        console.warn('Erro ao excluir anexos:', anexoError);
    }
    
    // Depois excluir o lançamento
    const { error } = await supabaseClient
        .from('lancamentos')
        .delete()
        .eq('id', id);
    
    if (error) {
        throw new Error(`Erro ao excluir lançamento: ${error.message}`);
    }
    
    return true;
}

async function getNotasFromSupabase(filters = {}) {
    if (!supabaseClient) {
        throw new Error('Supabase não inicializado');
    }
    
    let query = supabaseClient
        .from('lancamentos')
        .select(`
            *,
            anexos (
                id,
                arquivo_nome,
                arquivo_path,
                arquivo_url
            )
        `)
        .order('created_at', { ascending: false });
    
    // Aplicar filtros
    if (filters.tipo && filters.tipo !== 'TODOS') {
        query = query.eq('tipo', filters.tipo);
    }
    
    if (filters.status && filters.status !== 'TODOS') {
        query = query.eq('status', filters.status);
    }
    
    if (filters.competencia) {
        query = query.eq('competencia', filters.competencia);
    }
    
    if (filters.start_date && filters.end_date) {
        query = query
            .gte('competencia', filters.start_date)
            .lte('competencia', filters.end_date);
    }
    
    if (filters.search) {
        query = query.or(`
            descricao.ilike.%${filters.search}%,
            categoria.ilike.%${filters.search}%
        `);
    }
    
    const { data, error } = await query;
    
    if (error) {
        throw new Error(`Erro ao buscar lançamentos: ${error.message}`);
    }
    
    // Adaptar formato para compatibilidade com frontend
    return (data || []).map(item => adaptLancamentoToNota(item));
}

// Função para adaptar formato do banco para o frontend
function adaptLancamentoToNota(lancamento, attachmentOverride = null) {
    const attachment = attachmentOverride || (lancamento.anexos && lancamento.anexos[0] ? {
        name: lancamento.anexos[0].arquivo_nome,
        path: lancamento.anexos[0].arquivo_path,
        publicUrl: lancamento.anexos[0].arquivo_url,
    } : null);
    
    return {
        id: lancamento.id,
        tipo: lancamento.tipo,
        status: lancamento.status,
        fornecedor: lancamento.fornecedor,
        doc: null,
        categoria: lancamento.categoria,
        centroCusto: lancamento.subcategoria,
        competencia: lancamento.competencia.substring(0, 7), // YYYY-MM-01 para YYYY-MM
        vencimento: lancamento.competencia.substring(0, 7), // YYYY-MM-01 para YYYY-MM
        valor: lancamento.valor,
        numero: null,
        descricao: lancamento.descricao,
        criadoEm: lancamento.created_at,
        pagoEm: lancamento.data_pagamento,
        attachment
    };
}

// Função para migrar dados do localStorage para Supabase
async function migrateLocalStorageToSupabase() {
    const lsKey = "dre_mock_v2";
    const raw = localStorage.getItem(lsKey);
    
    if (!raw) return [];
    
    try {
        const obj = JSON.parse(raw);
        if (!Array.isArray(obj.notas) || obj.notas.length === 0) return [];
        
        const migratedNotas = [];
        
        for (const nota of obj.notas) {
            try {
                const notaData = {
                    id: nota.id,
                    tipo: nota.tipo,
                    status: nota.status,
                    categoria: nota.categoria,
                    centro_custo: nota.centroCusto || null,
                    competencia: nota.competencia,
                    valor: nota.valor,
                    descricao: nota.descricao || `${nota.fornecedor} - ${nota.doc || ''}`,
                    pago_em: nota.pagoEm || null,
                    attachment_data: nota.attachment || null
                };
                
                const saved = await saveNotaToSupabase(notaData);
                migratedNotas.push(saved);
                
            } catch (error) {
                console.error('Erro ao migrar nota:', nota.id, error);
            }
        }
        
        // Limpar localStorage após migração bem-sucedida
        if (migratedNotas.length > 0) {
            localStorage.removeItem(lsKey);
        }
        
        return migratedNotas;
        
    } catch (error) {
        console.error('Erro ao migrar dados:', error);
        return [];
    }
}

// Verificar se Supabase está disponível
function isSupabaseAvailable() {
    return supabaseClient && typeof supabaseClient.from === 'function';
}

// Exportar funções
window.SupabaseDB = {
    init: initSupabase,
    uploadFile: uploadFileToSupabase,
    saveNota: saveNotaToSupabase,
    updateNota: updateNotaInSupabase,
    deleteNota: deleteNotaFromSupabase,
    getNotas: getNotasFromSupabase,
    migrateData: migrateLocalStorageToSupabase,
    isAvailable: isSupabaseAvailable
};