const scores = [12, 7, 21, 15];

let total = 0;
for (const score of scores) {
  total += score;
}

console.log("Total:", total);
console.log("Average:", total / scores.length);
