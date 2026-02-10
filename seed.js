const { withData } = require('./data');

async function seed() {
  await withData('tasks.json', (data) => {
    data.length = 0;
  });
  console.log('Created data/tasks.json');

  await withData('projects.json', (data) => {
    const now = new Date().toISOString();
    const links = { website: null, gdrive_folder: null, github_repo: null };

    data.length = 0;
    data.push(
      {
        id: 'proj_capitao',
        name: 'capitao.consulting',
        code: 'CAP',
        description: 'Professional consultancy firm',
        status: 'active',
        color: '#3B82F6',
        created_at: now,
        links: { ...links }
      },
      {
        id: 'proj_petvitaclub',
        name: 'PetVitaClub',
        code: 'PVC',
        description: 'Natural pet food e-commerce — validation phase',
        status: 'active',
        color: '#10B981',
        created_at: now,
        links: { ...links }
      },
      {
        id: 'proj_automation',
        name: 'Automation Tools',
        code: 'AUT',
        description: 'Micro-automation tools and scripts',
        status: 'active',
        color: '#8B5CF6',
        created_at: now,
        links: { ...links }
      },
      {
        id: 'proj_personal',
        name: 'Personal',
        code: 'PER',
        description: 'Personal tasks and projects',
        status: 'active',
        color: '#6B7280',
        created_at: now,
        links: { ...links }
      }
    );
  });
  console.log('Created data/projects.json');

  console.log('Seed complete.');
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
