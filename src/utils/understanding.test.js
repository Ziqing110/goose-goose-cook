// The offline answer reader: what it takes, and what it asks about again.
import test from "node:test";
import assert from "node:assert/strict";
import { ELICITATION_QUESTIONS } from "../data/dishes.js";
import { interpretAnswer, isNonAnswer } from "./understanding.js";

const q = Object.fromEntries(ELICITATION_QUESTIONS.map((question) => [question.id, question]));
const read = (id, text, context) => interpretAnswer(q[id], text, context);

test("diet: a word that isn't a dietary need is asked about, not taken", () => {
  const r = read("diet", "Megan.");
  assert.equal(r.status, "needs-followup");
  assert.equal(r.value, null);
  assert.match(r.followUp, /Did you mean “Vegan”\?/);
  assert.deepEqual(r.suggestion, { value: "vegan", display: "Vegan" });

  const plain = read("diet", "Tuesday");
  assert.equal(plain.status, "needs-followup");
  assert.equal(plain.suggestion, undefined);
  assert.match(plain.followUp, /didn't catch a dietary need/);
});

test("diet: a yes takes the offered reading, a no asks openly instead of meaning 'none'", () => {
  const suggestion = { value: "vegan", display: "Vegan" };
  assert.deepEqual(read("diet", "Yes.", { alreadyAsked: true, suggestion }), { value: "vegan", display: "Vegan", status: "confirmed" });
  assert.deepEqual(read("diet", "uh yeah", { alreadyAsked: true, suggestion }).value, "vegan");
  const no = read("diet", "no", { alreadyAsked: true, suggestion });
  assert.equal(no.status, "needs-followup");
  assert.notEqual(no.value, "none");
  // Something else entirely is read as a fresh answer.
  assert.equal(read("diet", "gluten free", { alreadyAsked: true, suggestion }).value, "gluten free");
});

test("diet: real constraints in the cook's own words are still taken as given", () => {
  for (const said of ["nut allergy", "no pork", "gluten free", "dairy-free please", "my kid hates onions", "halal", "not too spicy", "lactose intolerant"]) {
    const r = read("diet", said);
    assert.equal(r.status, "confirmed", said);
    assert.equal(r.value, said.trim(), said);
  }
  for (const said of ["none", "no", "no allergies", "no thanks", "we eat everything", "nothing really"]) {
    assert.equal(read("diet", said).value, "none", said);
  }
});

test("a non-answer is never taken, however many times it is said", () => {
  // The screenshot: "三点四十，咋了?" was asked about, then "啊，可以，可以。"
  // ("ah, sure, sure") was taken as a one-hour target.
  for (const [id, said] of [
    ["targetTime", "啊，可以，可以。"], ["targetTime", "quick"], ["servings", "Megan"], ["servings", "好的"],
    ["skill", "Megan"], ["skill", "嗯"], ["dishIdea", "yes"], ["dishIdea", "可以"], ["diet", "okay"], ["diet", "嗯嗯"],
  ]) {
    for (const alreadyAsked of [false, true]) {
      const r = read(id, said, { alreadyAsked });
      assert.equal(r.status, "needs-followup", `${id} "${said}" alreadyAsked=${alreadyAsked}`);
      assert.equal(r.value, null);
    }
  }
  // The second ask points at the buttons instead of repeating itself.
  assert.notEqual(read("targetTime", "quick").followUp, read("targetTime", "quick", { alreadyAsked: true }).followUp);
});

test("isNonAnswer: acknowledgements and fillers in either language, not real words", () => {
  for (const said of ["okay", "Yes.", "um, sure", "what?", "I don't know", "啊，可以，可以。", "咋了?", "嗯", "好的好的", "随便"]) {
    assert.equal(isNonAnswer(said), true, said);
  }
  for (const said of ["ramen", "4", "vegan", "三点四十", "麻婆豆腐", "Megan", "no pork"]) {
    assert.equal(isNonAnswer(said), false, said);
  }
});

test("diet: a sentence that isn't about food is never a dietary need, even the second time", () => {
  // The screenshot: "I'm a duck." was asked about, then "I'm not a duck."
  // was taken because it had a "not" in it.
  for (const said of ["I'm a duck.", "I'm not a duck.", "no idea what you mean", "not today", "I don't want to answer", "我是一只鸭子", "我不要回答"]) {
    for (const alreadyAsked of [false, true]) {
      assert.equal(read("diet", said, { alreadyAsked }).status, "needs-followup", `${said} alreadyAsked=${alreadyAsked}`);
    }
  }
  // A near miss keeps offering its guess rather than taking it unasked.
  assert.equal(read("diet", "Megan", { alreadyAsked: true }).status, "needs-followup");
  // Diets by name, foods alone, restrictions on a food: all real.
  for (const said of ["Jain", "low carb", "keto", "peanuts", "shellfish and nuts", "duck", "anything but mushrooms", "no raw fish", "I'm not a fan of mushrooms", "my kid is a picky eater, no onions", "花生", "海鲜和花生", "不放葱"]) {
    assert.equal(read("diet", said).status, "confirmed", said);
  }
});

test("dishes: a sentence about yourself is not a dish", () => {
  for (const said of ["I'm a duck", "my name is Megan", "我是Megan"]) {
    assert.equal(read("dishIdea", said).status, "needs-followup", said);
  }
  assert.equal(read("dishIdea", "duck noodle soup").status, "confirmed");
});

test("Chinese answers are read, not asked about", () => {
  assert.equal(read("targetTime", "四十分钟").value, "40");
  assert.equal(read("targetTime", "一个半小时").value, "90");
  assert.equal(read("targetTime", "两个小时").value, "120");
  assert.equal(read("targetTime", "半小时").value, "30");
  assert.equal(read("servings", "四个人").value, "4");
  assert.equal(read("servings", "我们俩").value, "2");
  assert.equal(read("servings", "就我一个").value, "1");
  assert.equal(read("skill", "我是新手").value, "beginner");
  assert.equal(read("skill", "一般就行").value, "regular");
  assert.equal(read("skill", "简单点").value, "confident");
  assert.equal(read("diet", "没有").value, "none");
  assert.equal(read("diet", "都可以").value, "none");
  assert.equal(read("diet", "没有，都可以").value, "none");
  assert.equal(read("diet", "没有过敏").value, "none");
  assert.equal(read("diet", "不吃辣").value, "不吃辣");
  assert.equal(read("diet", "吃素").value, "vegetarian");
  assert.equal(read("diet", "我对花生过敏").value, "我对花生过敏");
});

test("targetTime: a time of day is offered back as a length from now, for a yes", () => {
  const now = new Date(2026, 8, 24, 14, 0); // 2pm
  const r = read("targetTime", "三点四十，咋了?", { now });
  assert.equal(r.status, "needs-followup");
  assert.deepEqual(r.suggestion, { value: "100", display: "100 minutes" });
  assert.match(r.followUp, /Done by 3:40 — that's about 1 hour 40 minutes from now/);
  assert.deepEqual(read("targetTime", "对", { suggestion: r.suggestion }).value, "100");
  assert.deepEqual(read("targetTime", "yes", { suggestion: r.suggestion }).value, "100");
  const no = read("targetTime", "不是", { suggestion: r.suggestion });
  assert.equal(no.status, "needs-followup");
  assert.equal(read("targetTime", "by 7:30 pm", { now }).suggestion.value, String(5 * 60 + 30));
  // Too far off to be a cooking time: ask for a length instead.
  const late = read("targetTime", "at 1:30", { now: new Date(2026, 8, 24, 13, 45) });
  assert.equal(late.suggestion, undefined);
});

test("a number that counts something else, or can't be right, is not taken as given", () => {
  // The screenshot: "6 light year." went down as a six-minute target.
  for (const said of ["6 light year.", "3 days", "20 km", "6光年"]) {
    const r = read("targetTime", said);
    assert.equal(r.status, "needs-followup", said);
    assert.match(r.followUp, /isn't a cooking time/, said);
    assert.equal(r.suggestion, undefined, said);
  }
  // Odd but possible: offered back for a yes.
  assert.deepEqual(read("targetTime", "6").suggestion, { value: "360", display: "360 minutes" });
  assert.match(read("targetTime", "6").followUp, /Did you mean 6 hours\?/);
  assert.deepEqual(read("targetTime", "5 minutes").suggestion, { value: "5", display: "5 minutes" });
  assert.deepEqual(read("targetTime", "10 hours").suggestion, { value: "600", display: "600 minutes" });
  assert.equal(read("targetTime", "yes", { suggestion: { value: "5", display: "5 minutes" } }).value, "5");
  // Still fine.
  assert.equal(read("targetTime", "about 40 or so").value, "40");
  assert.equal(read("targetTime", "45").value, "45");

  const light = read("servings", "6 light year");
  assert.equal(light.status, "needs-followup");
  assert.match(light.followUp, /isn't a number of people/);
  assert.deepEqual(read("servings", "50").suggestion, { value: "50", display: "50 servings" });
  assert.equal(read("servings", "0").status, "needs-followup");
  assert.equal(read("servings", "me and three mates").value, "4");
});

test("clear answers are unchanged", () => {
  assert.deepEqual(read("servings", "four"), { value: "4", display: "4 servings", status: "confirmed" });
  assert.deepEqual(read("servings", "just me"), { value: "1", display: "1 serving", status: "confirmed" });
  assert.equal(read("servings", "me and three mates").status, "low-confidence");
  assert.equal(read("servings", "4 people").value, "4");
  assert.equal(read("targetTime", "an hour and a half").value, "90");
  assert.equal(read("skill", "I'm new to this").value, "beginner");
  assert.deepEqual(read("dishIdea", "mapo tofu, egg drop soup").value, ["mapo tofu", "egg drop soup"]);
  assert.equal(read("diet", "Vegan").value, "vegan");
});
