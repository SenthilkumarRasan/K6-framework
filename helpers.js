// Helper function to generate random user data
export function generateRandomUser() {
  const randomId = Math.floor(Math.random() * 1000);
  return {
    id: randomId,
    name: `User${randomId}`,
    email: `user${randomId}@example.com`,
    password: 'password123',
  };
}

// Helper function to handle error
export function handleError(response, expectedStatus) {
  if (response.status !== expectedStatus) {
    console.error(`Expected status ${expectedStatus} but got ${response.status}`);
    console.error(`Response body: ${response.body}`);
    throw new Error(`=========Request failed with status=====> ${response.status}`);
  }
}