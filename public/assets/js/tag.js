let tags = [];

let rules = [
    {
        key: "Skill",
        rule: "hasParent",
        parameter: "Bloco"
    },
    {
        key: "Skill",
        rule: "skillValidation"
    },
    {
        key: "Skill",
        rule: "minNumber",
        parameter: 1,
    },
    {
        key: "Bloco",
        rule: "hasParent",
        parameter: "Trilha"
    },
    {
        key: "Bloco",
        rule: "blockValidation"
    },
    {
        key: "Trilha",
        rule: "hasParent",
        parameter: "Domínio"
    },
    {
        key: "Trilha",
        rule: "trailValidation"
    },
    {
        key: "Grupo Etário",
        rule: "existsIn",
        parameter: ['G1', 'G2', 'G3', 'G4']
    },
    {
        key: "Grupo Etário",
        rule: "exactNumber",
        parameter: 1
    },
    {
        key: "Processos",
        rule: "existsIn",
        parameter: ['Mindfulness', 'Retrospectiva', 'Saudação', 'Semana de Acampamento']
    },
    {
        key: "Adaptável para atípicos",
        rule: "exactNumber",
        parameter: 1
    },
    {
        key: "Adaptável para atípicos",
        rule: "existsIn",
        parameter: ['Sim', 'Não']
    },
    {
        key: "Tema",
        rule: "minNumber",
        parameter: 1
    },
    {
        key: "Subtema",
        rule: "hasParent",
        parameter: "Tema"
    },
    {
        key: "Tarefas Cognitivas",
        rule: "minNumber",
        parameter: 1
    },
    {
        key: "Quantidade de Alunos",
        rule: "exactNumber",
        parameter: 1
    }
];

/*
Key Value Rule [args]
Trilha Matemática comesWith Domínio Normal
Trilha Leitura comesWith Domínio Normal
Trilha Escrita comesWith Domínio Normal
Trilha Descoberta comesWith Domínio Normal
Competencia
*/
function insert(key, value){
    if(data[key]){

    }
    tags.push({key: key, value: value});
}


$(document).ready(() => {
    insert('Trilha', 'Matemática');
    insert('Trilha', 'Matemática');
});

